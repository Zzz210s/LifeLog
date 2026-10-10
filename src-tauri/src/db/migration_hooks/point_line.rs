//! 031 点 / 线的事务内前置钩子(schema 辅助):把 `entities` 改名为 `points`(保留旧 id)、
//! 补齐保留名字点 `子级`(id = 0)、并给 031 的 SQL 准备只读边源 `_point_line_edges`
//! (新库 = `edges` 上的临时视图;重放 = 同列空表)。建线与数据搬移仍在 `031_point_line.sql`。
//!
//! 为何改表名放钩子:同版本的后续钩子(Task 1.3 的 `points_fts_src` 视图)在迁移 SQL **之前**
//! 执行,必须已经能看到 `points`;而 `entities` → `points` 只是列集合一字不差的改名,不需要重建。
//! FK / 视图 / 触发器里的 `entities` 引用随 `ALTER TABLE ... RENAME` 一起改写。
use rusqlite::{Connection, OptionalExtension};

/// 031 的版本号(与 `MIGRATIONS` 追加 031 后的下标 +1 成对,见 `migrate.rs`)。
pub(crate) const POINT_LINE_VERSION: i64 = 31;

/// 保留名字点 `子级` 的固定 id(spec §14 P1 / 计划 P0-1)。真库点 id 从 1 起,0 可用。
pub(crate) const TREE_NAME_ID: i64 = 0;

fn table_exists(conn: &Connection, name: &str) -> rusqlite::Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [name],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

/// 031 前置钩子:改表名 + 保留点兜底 + 准备边源。可重复执行:
/// 已迁到 v31 的库(`points` 已存在)跳过改表名,重复调用不产生第二个 `子级`。
pub(crate) fn prepare_point_line(conn: &Connection) -> rusqlite::Result<()> {
    let has_points = table_exists(conn, "points")?;
    if !has_points {
        if !table_exists(conn, "entities")? {
            return Err(rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(1),
                Some("迁移 031:既没有 entities 也没有 points,无法重建点表".into()),
            ));
        }
        // 先下架旧 FTS 物件与 16 个触发器(它们引用 entities/edges;Task 1.3 会用 points/lines 重建),
        // 否则下面的保留点 INSERT 会触发旧 `entities_ai` → `entities_fts_src` 报 no such table。
        drop_legacy_fts_objects(conn)?;
        // 列集合与 v30 `entities` 一字不差,只改表名;旧 id 原样保留。
        conn.execute_batch("ALTER TABLE entities RENAME TO points;")?;
    }
    ensure_reserved_point(conn)?;
    prepare_edges_source(conn)
}

/// 旧 FTS 表 / 视图 / 16 个触发器(名字与真库 `sqlite_master` 实测一致),全部幂等。
fn drop_legacy_fts_objects(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "DROP TRIGGER IF EXISTS entities_ai;
         DROP TRIGGER IF EXISTS entities_ad;
         DROP TRIGGER IF EXISTS entities_au;
         DROP TRIGGER IF EXISTS entities_fts_closure_au;
         DROP TRIGGER IF EXISTS edges_ai;
         DROP TRIGGER IF EXISTS edges_ad;
         DROP TRIGGER IF EXISTS edges_au;
         DROP TRIGGER IF EXISTS edges_fts_closure_ai;
         DROP TRIGGER IF EXISTS edges_fts_closure_ad;
         DROP TRIGGER IF EXISTS edges_fts_closure_au;
         DROP TRIGGER IF EXISTS entity_aliases_ai;
         DROP TRIGGER IF EXISTS entity_aliases_au;
         DROP TRIGGER IF EXISTS entity_aliases_ad;
         DROP TRIGGER IF EXISTS entity_aliases_fts_closure_ai;
         DROP TRIGGER IF EXISTS entity_aliases_fts_closure_au;
         DROP TRIGGER IF EXISTS entity_aliases_fts_closure_ad;
         DROP VIEW IF EXISTS entities_fts_src;
         DROP TABLE IF EXISTS entities_fts;",
    )
}

/// 保留名字点 `子级` 存在即复用;`id = 0` 被别的点占用时拒绝(不做静默覆盖)。
fn ensure_reserved_point(conn: &Connection) -> rusqlite::Result<()> {
    let occupant: Option<String> = conn
        .query_row("SELECT meta FROM points WHERE id = ?1", [TREE_NAME_ID], |r| r.get(0))
        .optional()?;
    if let Some(meta) = occupant {
        if meta == "子级" {
            return Ok(());
        }
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(1),
            Some("迁移 031:id = 0 已被非保留点占用,不能建保留名字点 子级".into()),
        ));
    }
    conn.execute(
        "INSERT INTO points(id, meta, is_cited, created_at, color, parent_id, path, depth, sort_order)
         VALUES(?1, '子级', 0, datetime('now', 'localtime'), NULL, NULL, NULL, NULL, 0)",
        [TREE_NAME_ID],
    )?;
    Ok(())
}

/// 给 031 SQL 一个稳定的边源。新库把 `edges` 逐行拷进临时表;重放(`edges` 已随首个 031
/// 删除)建同列空表,让关系名点与线的 INSERT 都自然变成空操作(幂等的关键)。
/// 统一用临时表(不用视图),避免 `DROP VIEW` 撞上临时表时报 `use DROP TABLE`。
fn prepare_edges_source(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("DROP TABLE IF EXISTS _point_line_edges;")?;
    if table_exists(conn, "edges")? {
        conn.execute_batch("CREATE TEMP TABLE _point_line_edges AS SELECT * FROM edges;")
    } else {
        conn.execute_batch(
            "CREATE TEMP TABLE _point_line_edges(id INTEGER, source_id INTEGER, target_id INTEGER,
               kind TEXT, remark TEXT, created_at TEXT);",
        )
    }
}
