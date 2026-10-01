//! L3 反向引用读取的后端用例(IPC `note_link_counts` / `note_links` 背后的仓库函数):
//! 计数**批量**按 target 分组、未解析不入计数、入链标题取来源当前首行。
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
    let v = serde_json::to_value(note_links::Backlink { source_id: 7, title: "来源".into() }).unwrap();
    assert_eq!(v["sourceId"], serde_json::json!(7));
    assert!(v.get("source_id").is_none(), "不得再出现 snake 字段");
}

#[test]
fn link_counts_batch_ignore_unresolved() {
    let mut c = db();
    let target = notes::create_plain(&mut c, "甲").unwrap();
    let a = notes::create_plain(&mut c, "源A\n[[甲]]").unwrap();
    let b = notes::create_plain(&mut c, "源B\n[[甲]]").unwrap();
    let u = notes::create_plain(&mut c, "源C\n[[不存在的标题]]").unwrap();

    // 一页里混入"存在但没人引用"的 id 与不存在的 id:都不得出现在 Map 里
    let m = note_links::list_links_page(&c, &[target.id, a.id, b.id, u.id, 9999]).unwrap();
    assert_eq!(m.len(), 1, "只有被引用的目标进 Map");
    assert_eq!(m.get(&target.id), Some(&2), "甲 被两个来源引用");

    // 单条详情:入链恰两条,标题取来源首行(升序)
    let links = note_links::list_note_links(&c, target.id).unwrap();
    let titles: Vec<&str> = links.backlinks.iter().map(|b| b.title.as_str()).collect();
    assert_eq!(titles, vec!["源A", "源B"], "入链按来源 id 升序且标题取首行");
}

#[test]
fn link_counts_do_not_double_count_one_source() {
    let mut c = db();
    let target = notes::create_plain(&mut c, "甲").unwrap();
    // 同一来源正文写两遍同一个标题(大小写差异也归一):replace 只落一行 -> 计数为 1
    notes::create_plain(&mut c, "源\n[[甲]] 又 [[甲]]").unwrap();
    let m = note_links::list_links_page(&c, &[target.id]).unwrap();
    assert_eq!(m.get(&target.id), Some(&1), "同一来源算一个人");
    assert!(note_links::list_links_page(&c, &[]).unwrap().is_empty(), "空入参短路");
}
