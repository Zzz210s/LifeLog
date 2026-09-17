//! 自动时间标签的创建路径(spec 2026-09-17 D4/D5/D3):
//! 开关 `auto_time_tag` 决定是否加,模板 `time_tag_template` 决定加什么;
//! 自动标签必须与正文标签在**同一次** link_paths 写入 —— link_paths 是替换语义,
//! 分两次调用会把前一次写的链接整体抹掉。
//! 时间标签已是普通标签:正文里手写的 `#时间排序/...` 走普通解析,没有特殊拦截。
use super::*;
use crate::db::migrate;
use crate::db::repos::settings;
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// 该笔记的全部标签路径(升序)
fn paths(c: &Connection, id: i64) -> Vec<String> {
    let mut stmt = c
        .prepare(
            "SELECT t.path FROM tag_links l JOIN tags t ON t.id = l.tag_id
             WHERE l.target_type='note' AND l.target_id=?1 ORDER BY t.path",
        )
        .unwrap();
    let rows = stmt.query_map([id], |r| r.get(0)).unwrap();
    rows.map(|r| r.unwrap()).collect()
}

/// 该笔记在指定路径上的链接数(1 = 有,0 = 无)
fn links(c: &Connection, id: i64, path: &str) -> i64 {
    count(
        c,
        &format!(
            "SELECT COUNT(*) FROM tag_links l JOIN tags t ON t.id=l.tag_id
             WHERE l.target_type='note' AND t.path='{path}' AND l.target_id={id}"
        ),
    )
}

fn today_path(template_root: &str) -> String {
    let conn = Connection::open_in_memory().unwrap();
    let today = crate::timetag::today_local(&conn).unwrap();
    format!("{template_root}/{}", today.replace('-', "/"))
}

#[test]
fn create_adds_today_auto_tag_with_default_template() {
    let mut c = db();
    let path = today_path("时间排序");

    let n = create(&mut c, "正文 #工作").unwrap();

    assert_eq!(n.content, "正文");
    assert_eq!(paths(&c, n.id), vec!["工作".to_string(), path.clone()], "标签按路径升序");
    assert_eq!(links(&c, n.id, &path), 1, "自动标签已建链");
    let depth: i64 = c
        .query_row("SELECT depth FROM tags WHERE path=?1", [&path], |r| r.get(0))
        .unwrap();
    assert_eq!(depth, 4, "时间标签是四级路径");
}

/// 关键回归:自动标签与正文标签必须同批写入(分两次 link_paths 会互相抹掉)
#[test]
fn create_writes_body_tags_and_auto_tag_in_one_batch() {
    let mut c = db();
    let path = today_path("时间排序");

    let n = create(&mut c, "买牛奶 #todo #生活/超市").unwrap();

    let want = vec!["todo".to_string(), "生活/超市".to_string(), path.clone()];
    let mut want_sorted = want.clone();
    want_sorted.sort();
    assert_eq!(paths(&c, n.id), want_sorted, "正文标签与自动标签必须同时保留");
    for p in want {
        assert_eq!(links(&c, n.id, &p), 1, "{p} 的链接丢了(说明分两次写了)");
    }
}

#[test]
fn auto_time_tag_disabled_adds_nothing() {
    let mut c = db();
    settings::set(&c, settings::AUTO_TIME_TAG_KEY, "false").unwrap();

    let n = create(&mut c, "正文 #工作").unwrap();

    assert_eq!(paths(&c, n.id), vec!["工作".to_string()], "开关关闭:不加任何自动标签");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path LIKE '时间排序%'"), 0, "连根都不建");

    let n2 = create(&mut c, "无标签正文").unwrap();
    assert!(paths(&c, n2.id).is_empty());
}

/// 模板非法:降级为不加自动标签(正文标签照旧),不阻断保存
#[test]
fn invalid_template_degrades_to_no_auto_tag() {
    let mut c = db();
    settings::set(&c, settings::TIME_TAG_TEMPLATE_KEY, "时间排序/{y}/{m}").unwrap();

    let n = create(&mut c, "正文 #工作").unwrap();

    assert_eq!(paths(&c, n.id), vec!["工作".to_string()]);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path LIKE '时间排序%'"), 0);

    // 空串同样回退默认模板(而不是当成"不加")
    settings::set(&c, settings::TIME_TAG_TEMPLATE_KEY, "   ").unwrap();
    let n2 = create(&mut c, "空模板").unwrap();
    assert_eq!(paths(&c, n2.id), vec![today_path("时间排序")]);
}

#[test]
fn custom_template_decides_the_auto_tag_path() {
    let mut c = db();
    settings::set(&c, settings::TIME_TAG_TEMPLATE_KEY, "日期/{y}/{m}/{d}").unwrap();

    let n = create(&mut c, "改过模板 #工作").unwrap();

    assert_eq!(paths(&c, n.id), vec!["工作".to_string(), today_path("日期")]);
}

/// 用户手打的时间标签走普通解析(与自动标签并存,不特殊拦截、不报错)
#[test]
fn handwritten_time_tag_parses_normally() {
    let mut c = db();
    settings::set(&c, settings::AUTO_TIME_TAG_KEY, "false").unwrap();

    let n = create(&mut c, "手打 #时间排序/2026/01/02").unwrap();

    assert_eq!(n.content, "手打");
    assert_eq!(paths(&c, n.id), vec!["时间排序/2026/01/02".to_string()]);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='时间排序/2026/01/02'"), 1);
    // 深于四级的路径也允许(上限 5)
    create(&mut c, "更深 #时间排序/2026/01/02/子级").unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='时间排序/2026/01/02/子级'"), 1);
}

/// 编辑正文是替换语义,系统不再补回时间标签:编辑界面把标签回显为 `#tag` 文本
/// (`composeSource`),用户改时间就是改那段文本(D3:标签可编辑本来就是能力)。
#[test]
fn update_uses_exactly_the_tags_written_in_the_body() {
    let mut c = db();
    let auto = today_path("时间排序");
    let n = create(&mut c, "旧文 #甲标签").unwrap();
    assert!(paths(&c, n.id).contains(&auto));

    // 编辑界面回显:正文 + 全部标签(含自动标签)→ 保存后集合不变
    let roundtrip = format!("新文 #甲标签 #{auto}");
    let kept = update(&mut c, n.id, &roundtrip).unwrap().unwrap();
    assert_eq!(kept.tags, vec![auto.clone(), "甲标签".to_string()], "回显保存不丢标签");

    // 用户把时间改成别的日期:旧自动标签被替换(冲突收敛为一个,无需改期命令)
    let moved = update(&mut c, n.id, "新文 #甲标签 #时间排序/2020/05/06").unwrap().unwrap();
    assert_eq!(moved.tags, vec!["时间排序/2020/05/06".to_string(), "甲标签".to_string()]);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='时间排序/2020/05/06'"), 1);

    // 正文里没有标签:集合就是空(自动标签不会复活)
    let bare = update(&mut c, n.id, "无标签新文").unwrap().unwrap();
    assert!(bare.tags.is_empty());
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE name='甲标签'"), 0, "旧标签按语义回收");
}
