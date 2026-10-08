//! spec §3.7 七条对账的 Rust 落点。SQL **唯一真源**是 T1.0 写的
//! `scripts/entity-migration/reconcile.sql`(同源给 `reconcile.mjs` 与 Rust):
//! 这里只解析其中的标记块,不复制一行 SQL。跨出 `src-tauri` 的路径用 `CARGO_MANIFEST_DIR` 拼。
//! 七条统一以 v28 结构(`entities.meta` / `entities.is_cited`)为前置:列不存在时整组跳过(N/A),
//! 逐条命名函数与计数在 [`reconcile_checks`]。
use rusqlite::Connection;

/// 对账 SQL 唯一真源(标记块格式见该文件头注释)。
pub const RECONCILE_SQL: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../scripts/entity-migration/reconcile.sql"
));

pub use super::reconcile_checks::{
    check_1_is_cited, check_2_parent_child, check_3_path, check_4_depth, check_5_single_parent,
    check_6_sibling_key, check_7_id_contiguous, counts,
};

/// 一个对账块:`n` 序号(spec §3.7 ①–⑦)、`title` 标题、`requires` 需要的表/列、`sql` 单条 SELECT。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckBlock {
    pub n: String,
    pub title: String,
    pub requires: Vec<String>,
    pub sql: String,
}

impl CheckBlock {
    /// 失败信息用的「序号 标题」。
    pub fn label(&self) -> String {
        format!("{} {}", self.n, self.title)
    }
}

/// 解析 `-- @check | n | 标题 | mode | 表或列 | 期望` 标记块;块体到下一个标记为止,
/// 注释行(下一个块的段标题)不计入 SQL。只返回指定 `mode` 的块。
pub fn parse_checks(text: &str, mode: &str) -> Vec<CheckBlock> {
    let mut all: Vec<(String, String, String, Vec<String>, String)> = Vec::new();
    let mut cur: Option<(String, String, String, Vec<String>, String)> = None;
    for line in text.lines() {
        if let Some(body) = line.trim_start().strip_prefix("-- @") {
            if let Some(c) = cur.take() {
                all.push(c);
            }
            let f: Vec<&str> = body.split('|').map(str::trim).collect();
            if f.first() == Some(&"check") && f.len() >= 4 {
                let reqs = f.get(4).map(|s| s.split(',').map(str::trim).filter(|x| !x.is_empty()).map(String::from).collect()).unwrap_or_default();
                cur = Some((f[1].into(), f[2].into(), f[3].into(), reqs, String::new()));
            }
            continue;
        }
        if let Some(c) = cur.as_mut() {
            let t = line.trim();
            if !t.is_empty() && !t.starts_with("--") {
                c.4.push_str(t);
                c.4.push('\n');
            }
        }
    }
    if let Some(c) = cur.take() {
        all.push(c);
    }
    all.into_iter()
        .filter(|(_, _, m, _, sql)| m == mode && !sql.trim().is_empty())
        .map(|(n, title, _, requires, sql)| CheckBlock {
            n,
            title,
            requires,
            sql: sql.trim().trim_end_matches(';').trim_end().to_string(),
        })
        .collect()
}

/// 逐项检查「需要的表/列」是否存在;返回缺失项(空 = 可执行)。`t.c` 查 `table_info`,`t` 查 `sqlite_master`。
pub(crate) fn missing_requirements(conn: &Connection, reqs: &[String]) -> rusqlite::Result<Vec<String>> {
    let mut miss = Vec::new();
    for req in reqs {
        let n: i64 = match req.split_once('.') {
            Some((t, c)) => conn.query_row(
                "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
                rusqlite::params![t, c],
                |r| r.get(0),
            )?,
            None => conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = ?1",
                [req],
                |r| r.get(0),
            )?,
        };
        if n == 0 {
            miss.push(req.clone());
        }
    }
    Ok(miss)
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

/// 按序号跑一条 modern 对账块(缺块即 panic)。
pub(crate) fn run_named(conn: &Connection, n: &str) -> rusqlite::Result<Vec<String>> {
    let blocks = parse_checks(RECONCILE_SQL, "modern");
    let b = blocks
        .iter()
        .find(|b| b.n == n)
        .unwrap_or_else(|| panic!("reconcile.sql 缺少 modern 对账块 {n}"));
    run_check(conn, &b.sql)
}

/// 跑 spec §3.7 ①–⑦ 七条 modern 对账;任一命中即带序号/标题/命中行 panic。
/// 七条统一要求 v28 结构,列不存在时整组跳过(N/A);
/// 只依赖 `entities`/`edges`(以及连接注册的 `entity_name`/`entity_key`),阶段 4 删掉老表后仍可跑。
pub fn assert_cache_matches_edges(conn: &Connection) {
    let blocks = parse_checks(RECONCILE_SQL, "modern");
    let seven: Vec<&CheckBlock> = blocks.iter().filter(|b| is_seven(&b.n)).collect();
    assert_eq!(seven.len(), 7, "reconcile.sql 应含 1..7 七条 modern 对账");
    for b in seven {
        if !missing_requirements(conn, &b.requires).unwrap_or_else(|e| panic!("对账 {} 前置检查失败: {e}", b.label())).is_empty() {
            continue; // v28 结构未就位 -> N/A
        }
        let rows = run_check(conn, &b.sql).unwrap_or_else(|e| panic!("对账 {} 执行失败: {e}", b.label()));
        assert!(rows.is_empty(), "对账 {} 命中 {} 行: {rows:?}", b.label(), rows.len());
    }
}

/// spec §3.1:`is_cited` 必须逐行等于「有 `link` 入边」。
pub fn assert_is_cited_matches_edges(conn: &Connection) {
    let rows = check_1_is_cited(conn).expect("is_cited 对账执行失败");
    assert!(rows.is_empty(), "is_cited 与 link 入边不一致: {} 行 {rows:?}", rows.len());
}

fn is_seven(n: &str) -> bool {
    matches!(n, "1" | "2" | "3" | "4" | "5" | "6" | "7")
}
