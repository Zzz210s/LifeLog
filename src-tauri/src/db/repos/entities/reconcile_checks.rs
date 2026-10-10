//! spec §5.4 ①–⑩ 的命名对账函数与关键计数;SQL 与门控见 [`super::reconcile`]。
use rusqlite::Connection;

use super::reconcile::run_named;

/// spec §5.4 ① `is_cited` 与非子级线入边一致。
pub fn check_1_is_cited(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "1")
}

/// spec §5.4 ② 缓存 `parent_id` 与子级线入边一致。
pub fn check_2_parent_child(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "2")
}

/// spec §5.4 ③ 缓存 `path` 与推导路径一致。
pub fn check_3_path(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "3")
}

/// spec §5.4 ④ 缓存 `depth` 与线推导深度一致。
pub fn check_4_depth(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "4")
}

/// spec §5.4 ⑤ 子级线入度不超过 1。
pub fn check_5_single_parent(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "5")
}

/// spec §5.4 ⑥ 同父同键唯一(自动合并作用域)。
pub fn check_6_sibling_key(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "6")
}

/// spec §5.4 ⑦ 内容点 id 完整性(非空 / 唯一 / MIN>=1;无合并记录时还要求连号)。
/// 内容点判据在共享 SQL `scripts/entity-migration/reconcile.sql` 的块 ⑦(唯一真源):
/// 排除保留点 `p.id = 0`(空树库里位置判据不成立,不排除会把 MIN 拉到 0)与纯名字点。
pub fn check_7_id_integrity(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "7")
}

/// spec §5.4 ⑧ 纯名字点属性健全 + 名字引用无悬挂。
pub fn check_8_pure_name(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "8")
}

/// spec §5.4 ⑨ 保留点 `子级` 健全(`settings.tree_line_name_id` 指向 id = 0 且 `meta = '子级'`)。
pub fn check_9_reserved_point(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "9")
}

/// spec §5.4 ⑩ `graph_positions` / `ui.mru.notes` 的引用 id 有效且非名字点。
pub fn check_10_settings_refs(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "10")
}

/// 关键计数;`None` = v31 结构还不存在(v30 旧库整组为 `None`)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Counts {
    pub points: Option<i64>,
    pub lines: Option<i64>,
    pub lines_tree: Option<i64>,
    pub lines_named: Option<i64>,
    pub lines_unnamed: Option<i64>,
    pub pure_name_points: Option<i64>,
    pub is_cited: Option<i64>,
}

fn table_exists(conn: &Connection, table: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [table],
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n > 0)
}

fn scalar(conn: &Connection, sql: &str) -> rusqlite::Result<i64> {
    conn.query_row(sql, [], |r| r.get(0))
}

/// `points` / `lines` 读数;v31 结构未就位时整组 `None`。
pub fn counts(conn: &Connection) -> rusqlite::Result<Counts> {
    if !table_exists(conn, "points")? {
        return Ok(Counts::default());
    }
    let out = Counts {
        points: Some(scalar(conn, "SELECT COUNT(*) FROM points")?),
        is_cited: Some(scalar(conn, "SELECT COUNT(*) FROM points WHERE is_cited = 1")?),
        ..Counts::default()
    };
    if !table_exists(conn, "lines")? {
        return Ok(out);
    }
    Ok(Counts {
        lines: Some(scalar(conn, "SELECT COUNT(*) FROM lines")?),
        lines_tree: Some(scalar(conn, "SELECT COUNT(*) FROM lines WHERE name_id = 0")?),
        lines_named: Some(scalar(
            conn,
            "SELECT COUNT(*) FROM lines WHERE name_id IS NOT NULL AND name_id <> 0",
        )?),
        lines_unnamed: Some(scalar(conn, "SELECT COUNT(*) FROM lines WHERE name_id IS NULL")?),
        pure_name_points: Some(scalar(
            conn,
            "SELECT COUNT(*) FROM points p WHERE EXISTS(SELECT 1 FROM lines n WHERE n.name_id = p.id) \
             AND NOT EXISTS(SELECT 1 FROM lines t WHERE t.from_id = p.id OR t.to_id = p.id)",
        )?),
        ..out
    })
}
