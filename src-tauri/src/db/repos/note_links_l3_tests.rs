//! L3 反向引用读取的后端用例(IPC `note_links` 背后的仓库函数):
//! 未解析不入入链、入链标题取来源当前首行、同一来源去重。
//! 从 `note_links.rs` 挂载(与 note_links_tests.rs / note_links_fix_tests.rs 并列)。
use crate::db::migrate;
use crate::db::repos::note_links;
use crate::db::repos::notes;
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrate::run(&c).unwrap();
    c
}

#[test]
fn backlink_serializes_camel_case_for_the_panel() {
    // 前端 BacklinksPanel 读 `sourceId`(与 NoteLink 同 camelCase 口径)。少了 rename_all
    // 这里只有 snake 的 `source_id`,面板会拿 undefined 去跳转(真机验收读数 3 复现过)。
    let v = serde_json::to_value(note_links::read::Backlink { source_id: 7, title: "来源".into() }).unwrap();
    assert_eq!(v["sourceId"], serde_json::json!(7));
    assert!(v.get("source_id").is_none(), "不得再出现 snake 字段");
}

#[test]
fn link_counts_batch_ignore_unresolved() {
    let mut c = db();
    let target = notes::create_plain(&mut c, "甲").unwrap();
    let a = notes::create_plain(&mut c, "源A\n[[甲]]").unwrap();
    let b = notes::create_plain(&mut c, "源B\n[[甲]]").unwrap();
    notes::create_plain(&mut c, "源C\n[[不存在的标题]]").unwrap();

    // 单条详情:入链恰两条,标题取来源首行(升序);未解析的来源不进列表
    let links = note_links::list_note_links(&c, target.id).unwrap();
    assert_eq!(links.outbound.len(), 0, "目标自己没有出链");
    let titles: Vec<&str> = links.backlinks.iter().map(|b| b.title.as_str()).collect();
    assert_eq!(titles, vec!["源A", "源B"], "入链按来源 id 升序且标题取首行");
    let ids: Vec<i64> = links.backlinks.iter().map(|b| b.source_id).collect();
    assert_eq!(ids, vec![a.id, b.id]);
}

#[test]
fn link_counts_do_not_double_count_one_source() {
    let mut c = db();
    let target = notes::create_plain(&mut c, "甲").unwrap();
    // 同一来源正文写两遍同一个标题(大小写差异也归一):只留一条边 -> 入链只算一个人
    notes::create_plain(&mut c, "源\n[[甲]] 又 [[甲]]").unwrap();
    let links = note_links::list_note_links(&c, target.id).unwrap();
    assert_eq!(links.backlinks.len(), 1, "同一来源算一个人");
}
