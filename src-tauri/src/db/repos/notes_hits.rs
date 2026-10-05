//! 条件栏「命中 N 条」读数:每个标签 / 类型条件**独立**计数(spec 2026-10-05-tag-types §5)。
//! 口径与 `query_notes` 完全同源 —— 复用同一套谓词(标签含子级与携带继承、类型认领继承),
//! 保证「条件栏上写的命中数」与「点上去真查出来的条数」是同一个数。这里的计数**不叠加**
//! 其它条件(每个条件只回自己那一份命中集),所以多个条件是各自的读数而非交集。
use rusqlite::types::Value;
use rusqlite::Connection;
use serde::Serialize;

use super::notes::notes_filter::{type_predicate, tag_exists, tag_predicate, FilterConditions};

/// 四组读数与条件对象里的四个数组**同序**(前端按索引贴回对应 chip)
#[derive(Serialize, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConditionHits {
    pub tag_hits: Vec<i64>,
    pub exclude_tag_hits: Vec<i64>,
    pub type_hits: Vec<i64>,
    pub exclude_type_hits: Vec<i64>,
}

/// 单条件独立计数;条件数组为空时对应向量为空,不做任何查询
pub fn hits(conn: &Connection, c: &FilterConditions) -> Result<ConditionHits, String> {
    let mut out = ConditionHits::default();
    for t in &c.tags {
        let n = count_tag(conn, &t.path, !t.include_children)?;
        out.tag_hits.push(n);
    }
    for t in &c.exclude_tags {
        let n = count_tag(conn, &t.path, !t.include_children)?;
        out.exclude_tag_hits.push(n);
    }
    for r in &c.types {
        let n = count_type(conn, &r.path)?;
        out.type_hits.push(n);
    }
    for r in &c.exclude_types {
        let n = count_type(conn, &r.path)?;
        out.exclude_type_hits.push(n);
    }
    Ok(out)
}

/// 标签条件计数(值只进参数向量,与谓词占位符顺序一一对应)
fn count_tag(conn: &Connection, path: &str, self_only: bool) -> Result<i64, String> {
    let mut args = Vec::new();
    let predicate = tag_predicate(path, self_only, &mut args);
    count(conn, &predicate, args)
}

/// 类型条件计数
fn count_type(conn: &Connection, path: &str) -> Result<i64, String> {
    let mut args = Vec::new();
    let predicate = type_predicate(path, &mut args);
    count(conn, &predicate, args)
}

/// 数「挂了满足该谓词的标签」的笔记数(与 query_notes 的标签/类型子句同一个 EXISTS 包装)
fn count(conn: &Connection, predicate: &str, args: Vec<Value>) -> Result<i64, String> {
    conn.query_row(
        &format!("SELECT COUNT(*) FROM notes n WHERE {}", tag_exists(predicate)),
        rusqlite::params_from_iter(args),
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "notes_hits_tests.rs"]
mod notes_hits_tests;
