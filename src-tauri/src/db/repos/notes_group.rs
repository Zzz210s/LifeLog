//! 分组后端(设计 2026-10-06 §6,计划 T4):
//! - 分组键 = 轴(任意标签路径)下**一级子标签**,多值取树序第一 -> 只进一组;
//!   轴下无标签的笔记归 `key = NULL` 的哨兵组(组名 `（无 轴末段名）`),恒排最后,不受 `dir` 影响。
//! - 组间顺序 = 一级子标签的树序(`ord` 树序键),`dir` 反转;**排序条件只作用组内**。
//! - 分页:offset 作用域从全局降为组内 —— 骨架聚合 + 每组首屏(`PER_GROUP`,窗口函数)
//!   + 组内 offset 续页,组间互不干扰(折叠不影响别组 offset),不引游标状态机。
//! 本文件只有数据模型、骨架聚合与行折叠;键的 SQL 片段见 [`notes_group_key`](super::notes_group_key),
//! 分组/续页查询见 [`notes_group_query`](super::notes_group_query)(拆分守 200 行)。
use super::notes_filter::{where_clause, FilterConditions, GroupByCond};
use super::notes_group_key::group_key_cte;
use super::notes_page;
use super::tag_order;
use super::Note;
use rusqlite::{params_from_iter, types::Value, Connection};
use serde::Serialize;

/// 组数超过它 -> `degraded`(前端退化为平铺并给提示,设计 §6.4 D11;实测最粗轴 63 组)
pub const MAX_GROUPS: usize = 300;
/// 骨架聚合耗时超过它 -> `slow`(前端提示「结果很多,建议加筛选」)
pub const SLOW_MS: u128 = 200;
/// 每组首屏条数(窗口函数一次取全所有组的首屏;固定值,不提供每用户可调)
pub const PER_GROUP: i64 = 20;

/// 一个组的骨架:键 + 组名 + **该组在当前条件下的总数**(不是已加载数)+ 组间顺序键
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GroupSkeleton {
    /// 组键 = 一级子标签路径;`null` = 无该轴标签的哨兵组(恒最后)
    pub key: Option<String>,
    /// 组名 = 组键末段名;哨兵组为 `（无 轴末段名）`
    pub label: String,
    pub count: i64,
    /// 组间顺序键(ord 树序键;哨兵组为空串)
    pub order_key: String,
}

/// 骨架全量结果:`degraded`(组数过多)/ `slow`(聚合过慢)由后端判定,前端只读标志位
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkeletonResult {
    pub groups: Vec<GroupSkeleton>,
    pub elapsed_ms: u64,
    pub degraded: bool,
    pub slow: bool,
}

/// 一组:键 + 该组首屏(或续页)笔记(前端按骨架顺序渲染)
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupPage {
    pub key: Option<String>,
    pub notes: Vec<Note>,
}

/// 路径末段(组名口径同前端 `tagLeafName`)
fn leaf(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

/// 组名:组键末段;哨兵组用轴的末段名
fn label_of(key: &Option<String>, axis_leaf: &str) -> String {
    match key {
        Some(p) => leaf(p),
        None => format!("（无 {axis_leaf}）"),
    }
}

/// 组间方向:选项顺序(`asc`)/ 选项倒序(`desc`)
pub fn dir_sql(group_by: &GroupByCond) -> &'static str {
    if group_by.dir == "desc" {
        "DESC"
    } else {
        "ASC"
    }
}

/// 组骨架:一次 COUNT/GROUP BY 得 `[{key, label, count, orderKey}]`,组按树序排、哨兵组最后。
/// 与 `query` / `query_grouped` 共用同一份 `where_clause`(不另写一套筛选)。
pub fn skeleton(
    conn: &Connection,
    conditions: &FilterConditions,
    group_by: &GroupByCond,
) -> Result<SkeletonResult, String> {
    let start = std::time::Instant::now();
    let mut args: Vec<Value> = Vec::new();
    let grp = group_key_cte(&group_by.path, &mut args);
    let ctes = vec![tag_order::ORD_BODY.to_string(), grp];
    let (frag, where_args) = where_clause(conditions)?;
    args.extend(where_args);
    let dir = dir_sql(group_by);
    let sql = notes_page::with_ctes(
        &ctes,
        &format!(
            "SELECT g.key AS key, COUNT(*) AS cnt, MIN(g.gok) AS gok
         FROM entities n
         LEFT JOIN grp g ON g.note_id = n.id
         WHERE n.kind='note' AND {frag}
         GROUP BY g.key
         ORDER BY (g.key IS NULL), gok {dir}, g.key {dir}"
        ),
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(args), |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let axis_leaf = leaf(&group_by.path);
    let mut groups: Vec<GroupSkeleton> = Vec::new();
    for row in rows {
        let (key, count, gok) = row.map_err(|e| e.to_string())?;
        groups.push(GroupSkeleton {
            label: label_of(&key, &axis_leaf),
            count,
            order_key: gok.unwrap_or_default(),
            key,
        });
    }
    let elapsed_ms = start.elapsed().as_millis() as u64;
    Ok(SkeletonResult {
        degraded: groups.len() > MAX_GROUPS,
        slow: start.elapsed().as_millis() > SLOW_MS,
        groups,
        elapsed_ms,
    })
}

/// 相邻同组行折叠成一个 `(组键, Note)` 序列(标签行按 id 并入 `Note.tags`)
pub(crate) fn fold_grouped_rows(
    rows: impl Iterator<Item = rusqlite::Result<GroupRow>>,
) -> rusqlite::Result<Vec<(Option<String>, Note)>> {
    let mut out: Vec<(Option<String>, Note)> = Vec::new();
    for row in rows {
        let (key, id, content, created_at, tag) = row?;
        match out.last_mut() {
            Some((k, n)) if n.id == id && *k == key => {
                if let Some(t) = tag {
                    n.tags.push(t);
                }
            }
            _ => out.push((
                key,
                Note {
                    id,
                    content,
                    created_at,
                    tags: tag.into_iter().collect(),
                    links: Vec::new(),
                },
            )),
        }
    }
    Ok(out)
}

/// 分组查询的一行:组键 + note 基础列 + 可空标签路径
pub(crate) type GroupRow = (Option<String>, i64, String, String, Option<String>);

/// 一次 `IN (...)` 批量挂出链(与平铺分页同款;分组首屏可能有数百条笔记)
pub(crate) fn attach_all(
    conn: &Connection,
    flat: &mut [(Option<String>, Note)],
) -> Result<(), String> {
    let ids: Vec<i64> = flat.iter().map(|(_, n)| n.id).collect();
    let mut links =
        crate::db::repos::note_links::outbound_page(conn, &ids).map_err(|e| e.to_string())?;
    for (_, n) in flat.iter_mut() {
        n.links = links.remove(&n.id).unwrap_or_default();
    }
    Ok(())
}

#[cfg(test)]
#[path = "notes_group_tests.rs"]
mod notes_group_tests;
