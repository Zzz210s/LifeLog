//! 两段式孤儿回收与名字点回收队列(spec §6.3;自 tree.rs 抽出以守 200 行红线)。
//!
//! - **第一段(内容点 / 树内空壳)**:既无出线、又无**非子级线**入线才回收(循环删除,
//!   链有多长就循环多少次)。子级线是结构线,不算引用(spec §3.1 / §3.2);`path IS NOT NULL`
//!   保证只碰树内空壳,不误删树外笔记点。
//! - **第二段(名字点)**:名字点随线存在;写路径在删线 / 清名时把失去引用的名字点登记进
//!   [`queue_name_point_gc`],这里核对后回收。名字点的身份**只能由写路径提供** ——
//!   孤儿名字点与「无 `#` 无 `[[ ]]` 的无标签笔记点」在结构上完全相同(`path` / `parent_id`
//!   皆 NULL、无线参与、其余列同默认值),全库盲扫会把笔记点一起删掉,故不做无条件扫描。
use rusqlite::{params, Connection};

/// 两段式孤儿回收入口(第一段跑完接着跑第二段)。
pub(crate) fn gc_orphans(conn: &Connection) -> rusqlite::Result<()> {
    loop {
        let n = conn.execute(
            "DELETE FROM points
             WHERE path IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM lines x WHERE x.from_id = points.id)
               AND NOT EXISTS (
                 SELECT 1 FROM lines y
                 WHERE y.id IN (SELECT id FROM non_tree_lines WHERE to_id = points.id))",
            [],
        )?;
        if n == 0 {
            break;
        }
    }
    drain_name_point_gc(conn)
}

/// 只跑第二段(名字点回收),不碰树内空壳。
/// 关系写路径(建线 / 删线 / 换名)只可能让名字点失去引用,不该顺手回收无关的空标签。
pub(crate) fn reclaim_name_points(conn: &Connection) -> rusqlite::Result<()> {
    drain_name_point_gc(conn)
}

/// 登记一个「可能失去最后一条引用」的名字点,交给下一次 [`gc_orphans`] 核对回收。
/// 写路径在自己的事务里调用,回滚时登记随事务一起回滚。保留点也可登记 —— 保护在回收 SQL 里。
pub(crate) fn queue_name_point_gc(conn: &Connection, name_id: i64) -> rusqlite::Result<()> {
    conn.execute("CREATE TEMP TABLE IF NOT EXISTS _name_point_gc(id INTEGER PRIMARY KEY)", [])?;
    conn.execute("INSERT OR IGNORE INTO _name_point_gc(id) VALUES(?1)", params![name_id])?;
    Ok(())
}

/// 第二段本体:回收登记里「确实已无任何线引用」的名字点。
/// `AND NOT (points.id = 0)` 保护保留点 `子级`(spec §6.2 第一层;即使它被登记也不回收)。
fn drain_name_point_gc(conn: &Connection) -> rusqlite::Result<()> {
    let has_queue: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_temp_master WHERE type = 'table' AND name = '_name_point_gc'",
        [],
        |r| r.get(0),
    )?;
    if !has_queue {
        return Ok(());
    }
    conn.execute(
        "DELETE FROM points
          WHERE id IN (SELECT id FROM _name_point_gc)
            AND path IS NULL
            AND parent_id IS NULL
            AND NOT (points.id = 0)
            AND NOT EXISTS (
              SELECT 1 FROM lines l
              WHERE l.from_id = points.id OR l.to_id = points.id OR l.name_id = points.id)",
        [],
    )?;
    conn.execute("DELETE FROM _name_point_gc", [])?;
    Ok(())
}
