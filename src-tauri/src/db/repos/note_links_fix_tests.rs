//! 修复轮的回归用例:标签形不落行、归一化去重、显示标题保留原样。
//! 从 `note_links.rs` 挂载(与 note_links_tests.rs 并列),仓库层函数按 `note_links::x` 调。
use crate::db::migrate;
use crate::db::repos::note_links;
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrate::run(&c).unwrap();
    c
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn seed(c: &Connection, rows: &str) {
    c.execute_batch(&format!("INSERT INTO notes(id, content, created_at) VALUES {rows};")).unwrap();
}

#[test]
fn tag_shaped_title_writes_no_row() {
    let c = db();
    seed(&c, "(1,'源','2026-01-01')");
    // 合法标签形(`#甲` / `#工作/软件`)归一化后为空 key,连未解析行都不该留
    let n = note_links::replace(&c, 1, &["#甲".into(), "#工作/软件".into()]).unwrap();
    assert_eq!(n, 0);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM note_links"), 0, "空归一化 key 不落行(兜底)");
}

#[test]
fn duplicate_normalized_titles_are_one_row() {
    let c = db();
    seed(&c, "(1,'hello','2026-01-01'),(2,'源','2026-01-02')");
    let n = note_links::replace(&c, 2, &["Hello".into(), "hello".into()]).unwrap();
    assert_eq!(n, 1, "大小写差异归一化后指向同一目标");
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM note_links WHERE source_id = 2"),
        1,
        "同一目标两种写法只留一行,与入链 DISTINCT 口径一致"
    );
    let raw: String = c.query_row("SELECT raw_title FROM note_links", [], |r| r.get(0)).unwrap();
    assert_eq!(raw, "Hello", "保留首见的原文写法");
}

#[test]
fn display_title_keeps_original_case() {
    let c = db();
    seed(&c, "(1,'Hello World\n正文','2026-01-01'),(2,'源\n[[Hello World]]','2026-01-02')");
    note_links::replace(&c, 2, &["Hello World".into()]).unwrap();
    let out = note_links::list_note_links(&c, 2).unwrap();
    assert_eq!(out.outbound[0].title.as_deref(), Some("Hello World"), "出链显示标题保留大小写");
    let back = note_links::list_note_links(&c, 1).unwrap();
    assert_eq!(back.backlinks[0].title, "源", "入链显示标题取来源首行原样");
}
