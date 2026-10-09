//! 不变量的用例与自证(自 invariants_tests.rs 抽出,守 200 行上限):
//! 改名级联改写 filter_current;以及变异法证明 FTS 漂移检查真能报警。
use super::{assert_filter_paths_exist, assert_fts_matches_edges, assert_no_orphan_tags};
use crate::db::repos::settings::FILTER_CURRENT_KEY;
use rusqlite::{params, Connection};

/// 路径变化类操作(改名)必须级联改写 filter_current,且改写后的引用真实存在(不变量③)。
#[test]
fn rename_cascades_filter_and_keeps_invariants() {
    let mut c = Connection::open_in_memory().unwrap();
    crate::db::migrate::run(&c).unwrap();
    crate::db::repos::notes::create_plain(&mut c, "会议记录 #工作/项目A").unwrap();
    let filter = r##"{"keyword":null,"tags":[{"path":"工作/项目A","includeChildren":true}],"excludeTags":[{"path":"工作","includeChildren":false}],"tagPresence":null,"sort":"newest","expr":"#工作/项目A"}"##;
    crate::db::repos::settings::set(&c, FILTER_CURRENT_KEY, filter).unwrap();
    let root = id_at(&c, "工作");

    crate::db::repos::tags::rename(&mut c, root, "事业").unwrap();

    let raw = crate::db::repos::settings::get(&c, FILTER_CURRENT_KEY).unwrap().unwrap();
    assert!(raw.contains("事业/项目A") && !raw.contains("工作"), "条件未级联: {raw}");
    assert_fts_matches_edges(&c);
    assert_no_orphan_tags(&c);
    assert_filter_paths_exist(&c);
}

/// 变异法可证伪:绕开所有写入口直接制造两种不一致,测试台必须报错 ——
/// ① 删掉实体索引行(FTS 漂移);② 直接删 tagging 边不留孤儿回收(孤儿检查命中)。
#[test]
fn fts_invariant_catches_manual_update_drift() {
    let mut c = Connection::open_in_memory().unwrap();
    crate::db::migrate::run(&c).unwrap();
    let note = crate::db::repos::notes::create_plain(&mut c, "x #甲").unwrap();
    let jia = id_at(&c, "甲");

    // 变异 ①:直接删实体索引行(绕开所有仓库层入口)
    c.execute("DELETE FROM entities_fts WHERE rowid = ?1", params![note.id]).unwrap();
    let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| assert_fts_matches_edges(&c)))
        .expect_err("测试台必须抓到被删掉的 FTS 行");
    let msg = panic_message(err);
    assert!(msg.contains(&format!("实体 {}", note.id)), "报错要带实体 id: {msg}");
    assert!(msg.contains('甲'), "报错要带两侧取值: {msg}");

    // 变异 ②:直接删 tagging 边(edges_ad 会刷新 FTS,但甲确实成了孤儿)
    c.execute(
        "DELETE FROM edges WHERE kind = 'link' AND target_id = ?1",
        params![jia],
    )
    .unwrap();
    let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| assert_no_orphan_tags(&c)))
        .expect_err("孤儿检查必须抓到被改空的甲");
    assert!(panic_message(err).contains('甲'));
}

/// 测试台自身的读库入口:`SELECT id FROM entities WHERE path IS NOT NULL AND path = ?1`
fn id_at(conn: &Connection, path: &str) -> i64 {
    conn.query_row("SELECT id FROM entities WHERE path IS NOT NULL AND path = ?1", params![path], |r| r.get(0))
        .unwrap()
}

/// 取 panic 载荷里的报错文本(assert_eq! / assert! 的载荷是 String)
fn panic_message(payload: Box<dyn std::any::Any + Send>) -> String {
    payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| payload.downcast_ref::<&str>().map(|s| s.to_string()))
        .unwrap_or_else(|| "<非字符串 panic>".to_string())
}
