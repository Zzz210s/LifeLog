//! tags_tree_order_* 测试共用的构造与读取助手(仅测试编译)。
//! 兄弟序读口径 = (sort_order, path),与后端 apply_sibling_order 完全一致。
use crate::db::migrate;
use crate::db::repos::notes;
use rusqlite::Connection;

pub(super) fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

/// 建一条带标签的笔记(标签有链接才不会被 gc_orphans 回收)
pub(super) fn seed(c: &mut Connection, content: &str) {
    notes::create_plain(c, content).unwrap();
}

pub(super) fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", [path], |r| r.get(0))
        .unwrap()
}

/// 某父级下的兄弟完整路径(按后端口径 (sort_order, path))
pub(super) fn siblings(c: &Connection, parent: Option<i64>) -> Vec<String> {
    let mut stmt = c
        .prepare(
            "SELECT path FROM tags WHERE COALESCE(parent_id, 0) = COALESCE(?1, 0)
             ORDER BY sort_order, path",
        )
        .unwrap();
    let rows = stmt.query_map([parent], |r| r.get(0)).unwrap();
    rows.collect::<rusqlite::Result<Vec<_>>>().unwrap()
}

/// 某父级下的 sort_order 序列(与 siblings 同序)
pub(super) fn orders(c: &Connection, parent: Option<i64>) -> Vec<i64> {
    let mut stmt = c
        .prepare(
            "SELECT sort_order FROM tags WHERE COALESCE(parent_id, 0) = COALESCE(?1, 0)
             ORDER BY sort_order, path",
        )
        .unwrap();
    let rows = stmt.query_map([parent], |r| r.get(0)).unwrap();
    rows.collect::<rusqlite::Result<Vec<_>>>().unwrap()
}

/// 标签表全量快照(含 sort_order):用于"无操作/不改库"断言
pub(super) fn dump(c: &Connection) -> Vec<String> {
    let mut stmt = c
        .prepare(
            "SELECT id, COALESCE(parent_id, 0), path, depth, sort_order FROM tags
             ORDER BY id",
        )
        .unwrap();
    let rows = stmt
        .query_map([], |r| {
            Ok(format!(
                "{}|{}|{}|{}|{}",
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?
            ))
        })
        .unwrap();
    rows.collect::<rusqlite::Result<Vec<_>>>().unwrap()
}
