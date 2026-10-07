//! 条件栏「命中 N 条」读数:按**条件组 / 组内项**给出。口径与 `query_notes` 完全同源 ——
//! 复用同一份谓词(标签含子级与继承、关系指向继承),保证「条件栏上写的命中数」与
//! 「点上去真查出来的条数」是同一个数。
//! AND 组给逐项独立读数(每项只算自己那一份命中集,不叠加其它条件);
//! OR 组的逐项读数会产生误导(设计 §5.4),故只给整组命中数 `group_hit`。
use rusqlite::types::Value;
use rusqlite::Connection;
use serde::Serialize;

use super::notes::notes_filter::{normalize_groups, FilterConditions};
use super::notes::notes_filter_groups_compile::{group_where, item_hit_predicate};

/// 一个组的读数:组内 op + 逐项读数(与 items 同序)+ 整组命中数(OR 组必给)
#[derive(Serialize, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GroupHits {
    pub op: String,
    pub item_hits: Vec<i64>,
    pub group_hit: Option<i64>,
}

/// 读数与条件对象里的 `groups` **同序**(前端按组下标贴回对应 chip / 组头)
#[derive(Serialize, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConditionHits {
    pub groups: Vec<GroupHits>,
}

/// 按组计数;条件组为空时不做任何查询
pub fn hits(conn: &Connection, c: &FilterConditions) -> Result<ConditionHits, String> {
    let mut c = c.clone();
    normalize_groups(&mut c);
    let mut out = Vec::new();
    for g in &c.groups {
        // OR 组不给逐项读数(见模块头),AND 组逐项独立计数
        let mut item_hits = Vec::new();
        if g.op != "or" {
            for it in &g.items {
                let mut args = Vec::new();
                let pred = item_hit_predicate(it, &mut args)?.unwrap_or_else(|| "1=0".to_string());
                item_hits.push(count_predicate(conn, &pred, args)?);
            }
        }
        let group_hit = if g.op == "or" {
            let mut args = Vec::new();
            let frag = group_where(g, &mut args)?.unwrap_or_else(|| "1=0".to_string());
            Some(count_predicate(conn, &frag, args)?)
        } else {
            None
        };
        out.push(GroupHits { op: g.op.clone(), item_hits, group_hit });
    }
    Ok(ConditionHits { groups: out })
}

/// 数满足谓词的笔记数(谓词自带 EXISTS 包装 / NOT / IN;值只进参数向量)
fn count_predicate(conn: &Connection, predicate: &str, args: Vec<Value>) -> Result<i64, String> {
    conn.query_row(
        &format!("SELECT COUNT(*) FROM notes n WHERE ({predicate})"),
        rusqlite::params_from_iter(args),
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "notes_hits_tests.rs"]
mod notes_hits_tests;
