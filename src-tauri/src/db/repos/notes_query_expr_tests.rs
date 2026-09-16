//! 表达式条件(`expr`)在真实库上的语义验收:每条表达式都与等价的结构化条件交叉比对
//! 命中 id 集合(交叉比对即"两套输入只有一套语义"的证据)。
//! 自 notes_query_conds_tests.rs 分出以守 200 行上限,夹具与它保持一致。
use crate::db::migrate;
use crate::db::repos::notes::{create_on, create_plain, notes_filter::*, query, Note};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn tag(path: &str, include_children: bool) -> TagCond {
    TagCond { path: path.into(), include_children }
}

/// 命中笔记的 id 集合(升序):这里只断言集合,排序由既有排序测试覆盖
fn ids(notes: &[Note]) -> Vec<i64> {
    let mut v: Vec<i64> = notes.iter().map(|n| n.id).collect();
    v.sort_unstable();
    v
}

fn hits(c: &Connection, cond: &FilterConditions) -> Vec<i64> {
    ids(&query(c, cond, 0).unwrap())
}

/// 只带表达式的条件
fn expr_hits(c: &Connection, src: &str) -> Vec<i64> {
    hits(c, &FilterConditions { expr: Some(src.into()), ..empty() })
}

#[test]
fn expression_matches_structured_condition_with_children() {
    let mut c = db();
    let a = create_plain(&mut c, "会议 #工作/项目A/会议").unwrap();
    let b = create_plain(&mut c, "周报 #工作/项目A").unwrap();
    let d = create_plain(&mut c, "杂记 #工作").unwrap();
    create_plain(&mut c, "别家 #工作2").unwrap();
    create_plain(&mut c, "无关").unwrap();
    let structured = hits(&c, &FilterConditions { tags: vec![tag("工作", true)], ..empty() });
    assert_eq!(structured, vec![a.id, b.id, d.id], "结构化含子级:自身 + 子孙,不含同前缀兄弟");
    assert_eq!(expr_hits(&c, "#工作"), structured, "表达式 #工作 必须与结构化完全一致");
}

#[test]
fn self_only_tag_does_not_match_children() {
    let mut c = db();
    let parent = create_plain(&mut c, "本级 #工作").unwrap();
    let child = create_plain(&mut c, "子孙 #工作/项目A").unwrap();
    create_plain(&mut c, "同前缀兄弟 #工作2").unwrap();
    let structured = hits(&c, &FilterConditions { tags: vec![tag("工作", false)], ..empty() });
    assert_eq!(structured, vec![parent.id], "结构化仅本级只命中自身");
    assert_eq!(expr_hits(&c, "#=工作"), structured, "表达式 #=工作 与结构化仅本级一致");
    assert_eq!(expr_hits(&c, "#工作"), vec![parent.id, child.id], "含子级多命中子孙");
}

#[test]
fn not_tag_matches_notes_without_that_tag() {
    let mut c = db();
    let flagged = create_plain(&mut c, "有 #临时").unwrap();
    let bare = create_plain(&mut c, "无标签正文").unwrap();
    let other = create_plain(&mut c, "有别的 #电影").unwrap();
    assert_eq!(expr_hits(&c, "NOT #临时"), vec![bare.id, other.id], "无标签笔记也必须命中");
    assert_eq!(expr_hits(&c, "NOT NOT #临时"), vec![flagged.id], "双重否定回到原集合");
    let structured = hits(&c, &FilterConditions { exclude_tags: vec![tag("临时", true)], ..empty() });
    assert_eq!(expr_hits(&c, "NOT #临时"), structured, "与结构化排除标签一致");
    assert_eq!(hits(&c, &FilterConditions { expr: Some("   ".into()), ..empty() }).len(), 3);
}

#[test]
fn or_and_parens_combine_as_expected() {
    let mut c = db();
    let ab = create_plain(&mut c, "甲 #a #c").unwrap();
    let b = create_plain(&mut c, "乙 #b #c").unwrap();
    let a_only = create_plain(&mut c, "丙 #a").unwrap();
    let c_only = create_plain(&mut c, "丁 #c").unwrap();
    create_plain(&mut c, "戊 #b").unwrap();
    assert_eq!(expr_hits(&c, "(#a OR #b) AND #c"), vec![ab.id, b.id]);
    assert_eq!(expr_hits(&c, "#a OR #b AND #c"), vec![ab.id, b.id, a_only.id], "AND 优先于 OR");
    assert_eq!(expr_hits(&c, "#a"), vec![ab.id, a_only.id]);
    // 单标签叶子与结构化 tags=[...] 交叉比对
    let only_c = hits(&c, &FilterConditions { tags: vec![tag("c", true)], ..empty() });
    assert_eq!(expr_hits(&c, "#c"), vec![ab.id, b.id, c_only.id]);
    assert_eq!(expr_hits(&c, "#c"), only_c, "表达式 #c 与结构化 tags=[c] 一致");
}

#[test]
fn date_range_in_expression_matches_structured_from_to() {
    let mut c = db();
    let aug = create_on(&mut c, "八月", "2026-08-15").unwrap();
    let sep = create_on(&mut c, "九月", "2026-09-13").unwrap();
    let oct = create_on(&mut c, "十月", "2026-10-02").unwrap();
    create_plain(&mut c, "无时间标签").unwrap();
    let from = hits(&c, &FilterConditions { from: Some("2026-09-01".into()), ..empty() });
    assert_eq!(from, vec![sep.id, oct.id]);
    assert_eq!(expr_hits(&c, "date>=2026-09-01"), from, "date>= 与 from 一致");
    let to = hits(&c, &FilterConditions { to: Some("2026-09-13".into()), ..empty() });
    assert_eq!(to, vec![aug.id, sep.id], "to 含端点当天");
    assert_eq!(expr_hits(&c, "date<=2026-09-13"), to, "date<= 与 to 一致");
    let both = FilterConditions {
        from: Some("2026-08-01".into()),
        to: Some("2026-08-31".into()),
        ..empty()
    };
    assert_eq!(hits(&c, &both), vec![aug.id]);
    assert_eq!(expr_hits(&c, "date>=2026-08-01 AND date<=2026-08-31"), hits(&c, &both));
    // 严格比较按日级判定:当天本身不算"晚于/早于"
    assert_eq!(expr_hits(&c, "date>2026-09-13"), vec![oct.id]);
    assert_eq!(expr_hits(&c, "date<2026-09-01"), vec![aug.id]);
    assert_eq!(expr_hits(&c, "date=2026-08-15"), vec![aug.id]);
    // 更深的时间子标签(时间排序/Y/M/D/子级)与当天同界,不得因此被判到范围外
    let deep = create_on(&mut c, "九月子级", "2026-09-13").unwrap();
    let deep_path = vec!["时间排序/2026/09/13/子级".to_string()];
    crate::db::repos::tags_tree::link_paths(&c, deep.id, &deep_path).unwrap();
    assert_eq!(expr_hits(&c, "date=2026-09-13"), vec![sep.id, deep.id]);
    assert_eq!(expr_hits(&c, "date<2026-09-13"), vec![aug.id], "当天含子级也不落入 < 范围");
    assert_eq!(expr_hits(&c, "date>2026-09-13"), vec![oct.id], "当天含子级也不落入 > 范围");
}

#[test]
fn expression_ands_with_structured_conditions() {
    let mut c = db();
    let a = create_plain(&mut c, "复盘 #工作").unwrap();
    let b = create_plain(&mut c, "复盘 #生活").unwrap();
    let d = create_plain(&mut c, "新闻 #工作").unwrap();
    assert_eq!(hits(&c, &FilterConditions { keyword: Some("复盘".into()), ..empty() }), vec![a.id, b.id]);
    let work_only = hits(&c, &FilterConditions { tags: vec![tag("工作", true)], ..empty() });
    assert_eq!(work_only, vec![a.id, d.id], "只有标签没有关键词的「新闻」不命中关键词");
    let combined =
        FilterConditions { keyword: Some("复盘".into()), expr: Some("#工作".into()), ..empty() };
    assert_eq!(hits(&c, &combined), vec![a.id], "结构化关键词与表达式必须同时满足");
    let structured = hits(
        &c,
        &FilterConditions { keyword: Some("复盘".into()), tags: vec![tag("工作", true)], ..empty() },
    );
    assert_eq!(hits(&c, &combined), structured, "表达式 #工作 与结构化 tags=[工作] 等价");
    assert_eq!(expr_hits(&c, "复盘 AND #工作"), vec![a.id], "表达式内部 AND 同效");
    let excluded = FilterConditions {
        exclude_tags: vec![tag("工作", true)],
        expr: Some("#工作".into()),
        ..empty()
    };
    assert!(hits(&c, &excluded).is_empty(), "结构化排除与表达式 AND 后为空");
}

#[test]
fn invalid_expression_yields_no_rows_and_validate_rejects() {
    let mut c = db();
    let n = create_plain(&mut c, "正文 #甲").unwrap();
    let blank = FilterConditions { expr: Some("   ".into()), ..empty() };
    assert_eq!(hits(&c, &blank), vec![n.id], "空白表达式视为未设置");
    assert!(validate(&blank).is_ok());
    let bad = FilterConditions { expr: Some("#工作 AND".into()), ..empty() };
    assert!(query(&c, &bad, 0).unwrap().is_empty(), "非法表达式查不到任何行");
    assert_eq!(super::count_matching(&c, &bad).unwrap(), 0);
    // 位置是 **0 起字符下标**(与 expr::ExprError.pos、前端 setSelectionRange 同口径):
    // `#工作 AND` 共 7 个字符,错误指向末尾
    assert_eq!(validate(&bad).unwrap_err(), "表达式:缺少操作数(第 7 个字符)");
    // 非法表达式不得被忽略:结构化的其它条件照样被 AND 成恒假
    let ok = FilterConditions { tags: vec![tag("甲", true)], ..empty() };
    assert_eq!(hits(&c, &ok), vec![n.id]);
    let poisoned = FilterConditions { tags: vec![tag("甲", true)], expr: Some("#工作 AND".into()), ..empty() };
    assert!(hits(&c, &poisoned).is_empty(), "非法表达式让整条查询恒假");
    // 缺括号 / 超长同样被拒
    assert!(validate(&FilterConditions { expr: Some("(#a".into()), ..empty() }).is_err());
    assert!(validate(&FilterConditions { expr: Some("a".repeat(501)), ..empty() }).is_err());
}
