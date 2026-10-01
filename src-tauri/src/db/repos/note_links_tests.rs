//! 迁移 019(`note_links` 表与两个索引)与仓库层(替换写入 / 双向读取)的用例。
//! 从 `note_links.rs` 挂载,所以仓库层的函数可直接按 `note_links::x` 调。
use crate::db::migrate;
use crate::db::repos::note_links;
use rusqlite::Connection;

/// 内存库 + 跑完全部迁移。**显式开外键**:`ON DELETE SET NULL` / `CASCADE` 依赖它,
/// 而 `migrate::run` 不负责开(生产路径由 `db::open` 开,见 src-tauri/src/db/mod.rs)。
fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrate::run(&c).unwrap();
    c
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn migration_creates_table_and_indexes() {
    let c = db();
    let table = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='note_links'";
    assert_eq!(count(&c, table), 1, "迁移 019 应建出 note_links 表");
    let idx = "SELECT COUNT(*) FROM sqlite_master WHERE type='index' \
               AND name IN ('note_links_source','note_links_target')";
    assert_eq!(count(&c, idx), 2, "两个索引都要在(出链/入链方向各一)");
    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, 19, "迁移序列走完应是 19");
}

#[test]
fn target_fk_sets_null_on_delete() {
    let c = db();
    c.execute_batch(
        "INSERT INTO notes(id, content, created_at) VALUES (1,'源','2026-01-01'),(2,'目标','2026-01-02');
         INSERT INTO note_links(source_id, target_id, raw_title, created_at) VALUES (1,2,'目标','2026-01-03');",
    )
    .unwrap();
    c.execute("DELETE FROM notes WHERE id = 2", []).unwrap();
    let t: Option<i64> = c.query_row("SELECT target_id FROM note_links", [], |r| r.get(0)).unwrap();
    assert_eq!(t, None, "删目标笔记后链接退回未解析,而不是整行消失");
}

#[test]
fn source_fk_cascades_on_delete() {
    let c = db();
    c.execute_batch(
        "INSERT INTO notes(id, content, created_at) VALUES (1,'源','2026-01-01'),(2,'目标','2026-01-02');
         INSERT INTO note_links(source_id, target_id, raw_title, created_at) VALUES (1,2,'目标','2026-01-03');",
    )
    .unwrap();
    c.execute("DELETE FROM notes WHERE id = 1", []).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM note_links"), 0, "源没了链接无意义,整行级联删");
}

#[test]
fn migration_is_idempotent() {
    let c = db();
    // 同一连接重放:已是最新版本,run 应短路且不报错、版本号不变、表不重复建
    migrate::run(&c).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='note_links'"), 1);
    // 更硬的幂等:把版本退回 18 再跑,让 019 的 SQL 真的重放一遍
    // (与 done_doing/drop_updated_at 的幂等用例同法;IF NOT EXISTS 一旦被删,这里报 table already exists)
    c.pragma_update(None, "user_version", 18).unwrap();
    migrate::run(&c).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='note_links'"), 1);
    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, 19);
}

/// 建笔记(首行即标题),列顺序 id/content/created_at
fn seed(c: &Connection, rows: &str) {
    c.execute_batch(&format!("INSERT INTO notes(id, content, created_at) VALUES {rows};")).unwrap();
}

#[test]
fn replace_resolves_by_first_line() {
    let c = db();
    seed(&c, "(1,'目标笔记\n#日记','2026-01-01'),(2,'源','2026-01-02')");
    let n = note_links::replace(&c, 2, &["目标笔记".into(), "不存在的标题".into()]).unwrap();
    assert_eq!(n, 1, "只有一条解析成功");
    let rows: Vec<(Option<i64>, String)> = c
        .prepare("SELECT target_id, raw_title FROM note_links WHERE source_id = 2 ORDER BY raw_title")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(rows, vec![(None, "不存在的标题".to_string()), (Some(1), "目标笔记".to_string())]);
}

#[test]
fn replace_is_replacement_semantics() {
    let c = db();
    seed(&c, "(1,'甲','2026-01-01'),(2,'源','2026-01-02')");
    note_links::replace(&c, 2, &["甲".into()]).unwrap();
    note_links::replace(&c, 2, &["不存在".into()]).unwrap();
    let n = count(&c, "SELECT COUNT(*) FROM note_links WHERE source_id = 2");
    assert_eq!(n, 1, "第二次写入把第一次整批替换掉(与 tags::link_paths 同语义)");
    let t: Option<i64> = c.query_row("SELECT target_id FROM note_links", [], |r| r.get(0)).unwrap();
    assert_eq!(t, None, "旧的已解析行不残留");
}

#[test]
fn self_link_is_skipped() {
    let c = db();
    seed(&c, "(1,'自指','2026-01-01')");
    let n = note_links::replace(&c, 1, &["自指".into()]).unwrap();
    assert_eq!(n, 0, "指向自己不建边");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM note_links"), 0, "自指连未解析行都不留");
}

#[test]
fn duplicate_titles_take_earliest_id() {
    let c = db();
    seed(&c, "(7,'同名','2026-01-01'),(9,'同名','2026-01-02'),(2,'源','2026-01-03')");
    note_links::replace(&c, 2, &["同名".into()]).unwrap();
    let t: Option<i64> = c.query_row("SELECT target_id FROM note_links WHERE source_id = 2", [], |r| r.get(0)).unwrap();
    assert_eq!(t, Some(7), "重名取 id 最小(最早)的一条");
}

#[test]
fn duplicate_raw_title_in_one_note_is_one_row() {
    let c = db();
    seed(&c, "(1,'甲','2026-01-01'),(2,'源 [[甲]] 又 [[甲]]','2026-01-02')");
    note_links::replace(&c, 2, &["甲".into(), "甲".into()]).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM note_links WHERE source_id = 2"), 1,
        "同一来源写两遍同一个标题只留一行,否则被引用数会把一个人算两遍");
}

#[test]
fn page_counts_group_by_target() {
    let c = db();
    seed(&c, "(1,'甲','2026-01-01'),(2,'源A','2026-01-02'),(3,'源B','2026-01-03')");
    note_links::replace(&c, 2, &["甲".into()]).unwrap();
    note_links::replace(&c, 3, &["甲".into()]).unwrap();
    let m = note_links::list_links_page(&c, &[1, 2, 3]).unwrap();
    assert_eq!(m.get(&1), Some(&2), "甲 被引用 2 次");
    assert_eq!(m.get(&2), None, "没人引用源A");
    assert!(note_links::list_links_page(&c, &[]).unwrap().is_empty(), "空入参短路");
}

#[test]
fn list_note_links_returns_both_directions() {
    let c = db();
    seed(&c, "(1,'甲','2026-01-01'),(2,'源','2026-01-02')");
    note_links::replace(&c, 2, &["甲".into()]).unwrap();
    let out = note_links::list_note_links(&c, 2).unwrap();
    assert_eq!(out.outbound.len(), 1);
    assert_eq!(out.outbound[0].target_id, Some(1));
    assert_eq!(out.backlinks.len(), 0);
    let back = note_links::list_note_links(&c, 1).unwrap();
    assert_eq!(back.backlinks.len(), 1, "甲 有一条入链");
    assert_eq!(back.backlinks[0].source_id, 2);
    assert_eq!(back.backlinks[0].title, "源");
    assert_eq!(note_links::all_resolved(&c).unwrap(), vec![(2, 1)], "关系图读的已解析边");
}

#[test]
fn outbound_title_follows_target_current_first_line() {
    let c = db();
    seed(&c, "(1,'甲','2026-01-01'),(2,'源 [[甲]]','2026-01-02')");
    note_links::replace(&c, 2, &["甲".into()]).unwrap();
    c.execute("UPDATE notes SET content = '甲改' WHERE id = 1", []).unwrap();
    let out = note_links::list_note_links(&c, 2).unwrap();
    assert_eq!(out.outbound[0].raw_title, "甲", "正文原文不改");
    assert_eq!(out.outbound[0].title.as_deref(), Some("甲改"), "显示用目标当前首行(改名跟随)");
}
