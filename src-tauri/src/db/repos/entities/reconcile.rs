//! spec §3 五条缓存对账的 Rust 落点。SQL **唯一真源**是 T0.1 写的
//! `scripts/entity-migration/reconcile.sql`(同源给 `reconcile.mjs` 与 Rust):
//! 这里只解析其中的标记块,不复制一行 SQL。跨出 `src-tauri` 的路径用 `CARGO_MANIFEST_DIR` 拼。
use rusqlite::Connection;

/// 对账 SQL 唯一真源(标记块格式见该文件头注释)。
pub const RECONCILE_SQL: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../scripts/entity-migration/reconcile.sql"
));

/// 一个对账块:`n` 序号(spec §3 ①–⑤)、`title` 标题、`sql` 单条 SELECT。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckBlock {
    pub n: String,
    pub title: String,
    pub sql: String,
}

impl CheckBlock {
    /// 失败信息用的「序号 标题」。
    pub fn label(&self) -> String {
        format!("{} {}", self.n, self.title)
    }
}

/// 解析 `-- @check | n | 标题 | mode | 表 | 期望` 标记块;块体到下一个标记为止,
/// 注释行(下一个块的段标题)不计入 SQL。只返回指定 `mode` 的块。
pub fn parse_checks(text: &str, mode: &str) -> Vec<CheckBlock> {
    let mut all: Vec<(String, String, String, String)> = Vec::new();
    let mut cur: Option<(String, String, String, String)> = None;
    for line in text.lines() {
        if let Some(body) = line.trim_start().strip_prefix("-- @") {
            if let Some(c) = cur.take() {
                all.push(c);
            }
            let f: Vec<&str> = body.split('|').map(str::trim).collect();
            if f.first() == Some(&"check") && f.len() >= 4 {
                cur = Some((f[1].into(), f[2].into(), f[3].into(), String::new()));
            }
            continue;
        }
        if let Some(c) = cur.as_mut() {
            let t = line.trim();
            if !t.is_empty() && !t.starts_with("--") {
                c.3.push_str(t);
                c.3.push('\n');
            }
        }
    }
    if let Some(c) = cur.take() {
        all.push(c);
    }
    all.into_iter()
        .filter(|(_, _, m, sql)| m == mode && !sql.trim().is_empty())
        .map(|(n, title, _, sql)| CheckBlock {
            n,
            title,
            sql: sql.trim().trim_end_matches(';').trim_end().to_string(),
        })
        .collect()
}

/// 执行一条对账 SELECT,把命中行拍平成字符串(便于失败定位与断言)。
pub fn run_check(conn: &Connection, sql: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(sql)?;
    let cols = stmt.column_count();
    let mut rows = stmt.query([])?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut cells = Vec::with_capacity(cols);
        for i in 0..cols {
            cells.push(format!("{:?}", row.get::<_, rusqlite::types::Value>(i)?));
        }
        out.push(cells.join(" | "));
    }
    Ok(out)
}

fn run_named(conn: &Connection, n: &str) -> rusqlite::Result<Vec<String>> {
    let blocks = parse_checks(RECONCILE_SQL, "modern");
    let b = blocks
        .iter()
        .find(|b| b.n == n)
        .unwrap_or_else(|| panic!("reconcile.sql 缺少 modern 对账块 {n}"));
    run_check(conn, &b.sql)
}

/// spec §3 ① 缓存 `parent_id` 与 `child` 边一致。
pub fn check_1_parent_child(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "1")
}

/// spec §3 ② 缓存 `path` 与 `child` 边推导路径一致。
pub fn check_2_path(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "2")
}

/// spec §3 ③ 缓存 `depth` 与边推导深度一致。
pub fn check_3_depth(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "3")
}

/// spec §3 ④ 单亲约束(`child` 边入度不超过 1)。
pub fn check_4_single_parent(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "4")
}

/// spec §3 ⑤ 无悬挂引用(`child` 边指向存在的标签实体)。
pub fn check_5_dangling(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    run_named(conn, "5")
}

/// 跑 spec §3 ①–⑤ 五条 modern 对账;任一命中即带序号/标题/命中行 panic。
/// 只依赖 `entities`/`edges`,阶段 4 删掉老表后仍可跑。
pub fn assert_cache_matches_edges(conn: &Connection) {
    let blocks = parse_checks(RECONCILE_SQL, "modern");
    let checks: [(&str, fn(&Connection) -> rusqlite::Result<Vec<String>>); 5] = [
        ("1", check_1_parent_child),
        ("2", check_2_path),
        ("3", check_3_depth),
        ("4", check_4_single_parent),
        ("5", check_5_dangling),
    ];
    for (n, f) in checks {
        let b = blocks
            .iter()
            .find(|b| b.n == n)
            .unwrap_or_else(|| panic!("reconcile.sql 缺少 modern 对账块 {n}"));
        let rows = f(conn).unwrap_or_else(|e| panic!("对账 {} 执行失败: {e}", b.label()));
        assert!(rows.is_empty(), "对账 {} 命中 {} 行: {rows:?}", b.label(), rows.len());
    }
}

/// 关键计数;`None` = 该表在当前阶段还不存在(阶段 4 删老表后 `tags`/`tag_links` 为 `None`)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Counts {
    pub tags: Option<i64>,
    pub entities: Option<i64>,
    pub entities_tag: Option<i64>,
    pub child: Option<i64>,
    pub tagging: Option<i64>,
    pub relation: Option<i64>,
    pub link: Option<i64>,
}

fn count_where(conn: &Connection, table: &str, filter: &str) -> rusqlite::Result<Option<i64>> {
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [table],
        |r| r.get(0),
    )?;
    if exists == 0 {
        return Ok(None);
    }
    conn.query_row(&format!("SELECT COUNT(*) FROM {table} {filter}"), [], |r| {
        r.get(0)
    })
    .map(Some)
}

/// `entities`/`edges` 分 kind 计数,兼带老 `tags` 读数。
pub fn counts(conn: &Connection) -> rusqlite::Result<Counts> {
    Ok(Counts {
        tags: count_where(conn, "tags", "")?,
        entities: count_where(conn, "entities", "")?,
        entities_tag: count_where(conn, "entities", "WHERE kind = 'tag'")?,
        child: count_where(conn, "edges", "WHERE kind = 'child'")?,
        tagging: count_where(conn, "edges", "WHERE kind = 'tagging'")?,
        relation: count_where(conn, "edges", "WHERE kind = 'relation'")?,
        link: count_where(conn, "edges", "WHERE kind = 'link'")?,
    })
}
