//! 条件对象 -> SQL 片段生成与校验的纯函数测试(测试先行 TDD;不依赖数据库)
use super::notes_filter::*;

fn tag(path: &str, include_children: bool) -> TagCond {
    TagCond { path: path.into(), include_children }
}

#[test]
fn empty_conditions_match_everything() {
    assert_eq!(where_clause(&empty()).unwrap(), ("1=1".to_string(), vec![]));
    assert!(!oldest_first(&empty()));
}

#[test]
fn tag_include_children_uses_prefix() {
    let c = FilterConditions { tags: vec![tag("工作", true)], ..empty() };
    let (sql, args) = where_clause(&c).unwrap();
    assert!(sql.contains("t.path = ? OR substr(t.path, 1, length(?) + 1) = ? || '/'"));
    assert_eq!(args.len(), 3);
}

#[test]
fn tag_exact_match_has_no_prefix() {
    let c = FilterConditions { tags: vec![tag("工作", false)], ..empty() };
    let (sql, args) = where_clause(&c).unwrap();
    assert!(sql.contains("t.path = ?"));
    assert!(!sql.contains("substr"));
    assert_eq!(args.len(), 1);
}

#[test]
fn two_tags_are_anded() {
    let c = FilterConditions { tags: vec![tag("a", false), tag("b", false)], ..empty() };
    let (sql, _) = where_clause(&c).unwrap();
    assert_eq!(sql.matches("t.path = ?").count(), 2);
    assert!(sql.contains(" AND "));
}

#[test]
fn exclude_tag_uses_not_exists() {
    let c = FilterConditions { exclude_tags: vec![tag("临时", true)], ..empty() };
    let (sql, args) = where_clause(&c).unwrap();
    assert!(sql.contains("NOT EXISTS"));
    assert_eq!(args.len(), 3);
}

/// 有无标签:时间标签也是普通标签(D3),一律计入;any/none 必须成对。
#[test]
fn tag_presence_counts_all_tags() {
    let c = FilterConditions { tag_presence: Some("none".into()), ..empty() };
    let (sql, _) = where_clause(&c).unwrap();
    assert!(sql.contains("NOT (EXISTS (SELECT 1 FROM tag_links l"), "{sql}");
    assert!(!sql.contains("时间排序"), "不再有时间子树例外:{sql}");

    let c = FilterConditions { tag_presence: Some("any".into()), ..empty() };
    let (sql, _) = where_clause(&c).unwrap();
    assert!(sql.starts_with("1=1 AND EXISTS (SELECT 1 FROM tag_links l"), "{sql}");
    assert!(!sql.contains("NOT (EXISTS"), "any 不得带排除:{sql}");
}

/// 短关键词(<=2 字符)退化 LIKE 时正文与标签两侧一视同仁(时间标签已是普通标签,D3)
#[test]
fn short_keyword_like_branch_has_no_time_tag_exception() {
    let c = FilterConditions { keyword: Some("11".into()), ..empty() };
    let (sql, args) = where_clause(&c).unwrap();
    assert!(sql.contains("n.content LIKE ?"), "{sql}");
    assert!(sql.contains("AND t.path LIKE ?"), "{sql}");
    assert!(!sql.contains("时间排序"), "时间标签不再被排除:{sql}");
    assert_eq!(texts(&args), vec!["%11%", "%11%"]);
}

/// 参数向量的文本视图(断言生成的路径边界)
fn texts(args: &[rusqlite::types::Value]) -> Vec<String> {
    args.iter()
        .map(|v| match v {
            rusqlite::types::Value::Text(t) => t.clone(),
            other => panic!("非文本参数:{other:?}"),
        })
        .collect()
}

/// 011 之前的存量条件 JSON 带 from/to:反序列化必须静默忽略这两个键(升级兼容)
#[test]
fn legacy_from_to_keys_are_ignored() {
    let c: FilterConditions = serde_json::from_str(
        r#"{"keyword":"甲乙丙","tags":[],"excludeTags":[],"from":"2026-08-01","to":"2026-08-31","tagPresence":null,"sort":"oldest","expr":null}"#,
    )
    .unwrap();
    assert_eq!(c.keyword.as_deref(), Some("甲乙丙"));
    assert!(c.sort.as_deref() == Some("oldest"));
    assert!(validate(&c).is_ok(), "旧键不得导致校验失败");
    let (sql, args) = where_clause(&c).unwrap();
    assert!(!sql.contains("created_at"), "{sql}");
    assert_eq!(args.len(), 1, "只剩关键词一个参数");
}

#[test]
fn sort_oldest_flips_order() {
    let c = FilterConditions { sort: Some("oldest".into()), ..empty() };
    assert!(oldest_first(&c));
    assert!(!oldest_first(&FilterConditions { sort: Some("newest".into()), ..empty() }));
}

#[test]
fn validate_rejects_bad_input() {
    assert!(validate(&FilterConditions { tags: vec![tag("", false)], ..empty() }).is_err());
    assert!(validate(&FilterConditions { tags: vec![tag("a//b", false)], ..empty() }).is_err());
    assert!(validate(&FilterConditions { keyword: Some("x".repeat(201)), ..empty() }).is_err());
    assert!(validate(&FilterConditions { sort: Some("sideways".into()), ..empty() }).is_err());
    assert!(validate(&FilterConditions {
        tags: (0..21).map(|i| tag(&format!("t{i}"), false)).collect(), ..empty()
    }).is_err());
    assert!(validate(&(FilterConditions { tags: vec![tag("工作", true)], ..empty() })).is_ok());
}

/// 校验还须拒绝:标签有无取值非法、排除标签越限
#[test]
fn validate_rejects_more_bad_input() {
    assert!(validate(&FilterConditions { tag_presence: Some("some".into()), ..empty() }).is_err());
    assert!(validate(&FilterConditions {
        exclude_tags: (0..21).map(|i| tag(&format!("t{i}"), false)).collect(), ..empty()
    }).is_err());
    assert!(validate(&FilterConditions { tags: vec![tag("工作/项目A", true)], ..empty() }).is_ok());
}

/// 关键词/标签条件都是**参数占位**:片段里不得出现 LIKE 通配符,值只进参数向量
#[test]
fn tag_values_go_through_placeholders_only() {
    let c = FilterConditions { tags: vec![tag("a%b_c", true)], exclude_tags: vec![tag("x/y", true)], ..empty() };
    let (sql, args) = where_clause(&c).unwrap();
    assert!(!sql.contains('%'));
    assert!(!sql.contains("a%b_c"));
    assert_eq!(args.len(), 6);
    let texts: Vec<String> = args
        .iter()
        .map(|v| match v {
            rusqlite::types::Value::Text(t) => t.clone(),
            other => panic!("非文本参数:{other:?}"),
        })
        .collect();
    assert_eq!(texts, vec!["a%b_c", "a%b_c", "a%b_c", "x/y", "x/y", "x/y"]);
}

/// 表达式非法:位置口径 = 原文 0 起下标 +1,且**解析原文** —— 前后空白也占字符,
/// 若按 trim 后解析会把 `&` 错报成「第 2 个字符」
#[test]
fn expr_error_position_counts_original_text() {
    let c = FilterConditions { expr: Some("  a&b  ".into()), ..empty() };
    assert_eq!(validate(&c).unwrap_err(), "表达式:第 4 个字符:缺少操作数");
}

/// 末尾类错误改说「表达式末尾」,不编造输入串里不存在的字符序号;串内错误仍是 +1 序号
#[test]
fn expr_error_label_distinguishes_end_from_inner_position() {
    let end = FilterConditions { expr: Some("#工作 AND".into()), ..empty() };
    assert_eq!(validate(&end).unwrap_err(), "表达式:表达式末尾:缺少操作数");
    let head = FilterConditions { expr: Some("date>=2026-01-01".into()), ..empty() };
    assert_eq!(validate(&head).unwrap_err(), "表达式:第 1 个字符:日期比较已取消,请用时间标签筛选");
}

/// 非法表达式不再降级成 `0=1` 恒假:where_clause 与 validate 同一条规则、同一份文案
#[test]
fn invalid_expr_fails_where_clause_with_same_message() {
    for src in ["a&b", "#工作 AND", "  a|b  ", "date>=2026-01-01"] {
        let c = FilterConditions { expr: Some(src.into()), ..empty() };
        let from_where = where_clause(&c).unwrap_err();
        assert_eq!(from_where, validate(&c).unwrap_err(), "{src}");
        assert!(from_where.starts_with("表达式:"), "{src}:文案需带「表达式:」前缀");
    }
}

/// 空白-only 仍视为未设置(唯一用 trim 的地方);前后空白不改语义与参数
#[test]
fn blank_expr_is_unset_and_whitespace_keeps_semantics() {
    let blank = FilterConditions { expr: Some("   ".into()), ..empty() };
    assert!(validate(&blank).is_ok());
    assert_eq!(where_clause(&blank).unwrap().0, "1=1");
    let padded = FilterConditions { expr: Some("  #工作  ".into()), ..empty() };
    let (sql, args) = where_clause(&padded).unwrap();
    assert!(sql.contains("substr"), "标签谓词照旧编译:{sql}");
    assert_eq!(args.len(), 3);
    let bare = where_clause(&FilterConditions { expr: Some("#工作".into()), ..empty() }).unwrap().1;
    assert_eq!(args, bare, "前后空白不改变参数");
}
