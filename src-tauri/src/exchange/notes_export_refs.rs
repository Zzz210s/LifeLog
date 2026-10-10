//! 导出「引用路径」列的闭包真源(与 030 的 FTS 聚合 [`crate::db::repos::entities::fts::ENTITIES_AGG`]
//! 逐层同口径,故规则写在两处:闭包维度必须一起改)。
//!
//! 每个实体的引用列 = 下列集合的显示名(去重、按显示名升序):
//!   ① 出 `link` 边的直链目标 `T`;
//!   ② `T` 的子孙(沿 `parent_id` 递归);
//!   ③ `T` **及其祖先链**上每个树内实体出 `link` 边指向的 `B`,以及 `B` 的子孙。
//!
//! ③ 沿祖先链走:笔记挂 `A/sub` 时,祖先 `A` 的关系(`A --(remark)--> B`)同样成立,
//! 与筛选侧 `carry_predicate`(命中集 = 关系源本身 ∪ 后代)同一口径。
//! `remark` 不参与(只影响显示,审计 R6)。展开最多一跳,不递归关系链。
use crate::links::display_title;
use crate::tag_label::label_plain;
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};

/// 实体行:id -> (path, meta, parent_id)
struct Ent {
    path: Option<String>,
    meta: String,
    parent_id: Option<i64>,
}

/// 每个实体的出链闭包显示名(按 source_id 分组,组内按显示名升序)。无出链的实体不出现。
pub(super) fn refs_by_source(conn: &Connection) -> Result<HashMap<i64, Vec<String>>, String> {
    let ents = load_entities(conn)?;
    let out = load_out_links(conn)?;
    let children = build_children(&ents);
    let mut map: HashMap<i64, Vec<String>> = HashMap::new();
    for &source in out.keys() {
        let targets: Vec<i64> = out.get(&source).cloned().unwrap_or_default();
        let mut ids: HashSet<i64> = targets.iter().copied().collect();
        for t in &targets {
            collect_descendants(*t, &children, &mut ids); // ②
            for a in ancestors_or_self(*t, &ents) {
                for b in out.get(&a).into_iter().flatten() { // ③
                    ids.insert(*b);
                    collect_descendants(*b, &children, &mut ids);
                }
            }
        }
        let mut names: Vec<String> = ids.iter().filter_map(|id| display_of(ents.get(id))).collect();
        names.sort();
        names.dedup();
        if !names.is_empty() {
            map.insert(source, names);
        }
    }
    Ok(map)
}

/// 显示名:树内实体用路径的可见文本,树外实体(笔记)用 `meta` 首行标题;空名跳过。
fn display_of(e: Option<&Ent>) -> Option<String> {
    let e = e?;
    let label = match &e.path {
        Some(p) => label_plain(p),
        None => display_title(&e.meta),
    };
    (!label.is_empty()).then_some(label)
}

fn load_entities(conn: &Connection) -> Result<HashMap<i64, Ent>, String> {
    let mut stmt = conn
        .prepare("SELECT id, path, meta, parent_id FROM entities")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                Ent {
                    path: r.get(1)?,
                    meta: r.get(2)?,
                    parent_id: r.get(3)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut map = HashMap::new();
    for row in rows {
        let (id, ent) = row.map_err(|e| e.to_string())?;
        map.insert(id, ent);
    }
    Ok(map)
}

fn load_out_links(conn: &Connection) -> Result<HashMap<i64, Vec<i64>>, String> {
    let mut stmt = conn
        .prepare("SELECT source_id, target_id FROM edges WHERE kind = 'link'")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut map: HashMap<i64, Vec<i64>> = HashMap::new();
    for row in rows {
        let (s, t) = row.map_err(|e| e.to_string())?;
        map.entry(s).or_default().push(t);
    }
    Ok(map)
}

fn build_children(ents: &HashMap<i64, Ent>) -> HashMap<i64, Vec<i64>> {
    let mut children: HashMap<i64, Vec<i64>> = HashMap::new();
    for (&id, e) in ents {
        if let Some(p) = e.parent_id {
            children.entry(p).or_default().push(id);
        }
    }
    children
}

/// 从 `root` 沿 `parent_id` 上溯(含自身);visited 防脏数据里的父链成环。
fn ancestors_or_self(root: i64, ents: &HashMap<i64, Ent>) -> Vec<i64> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut cur = Some(root);
    while let Some(id) = cur {
        if !seen.insert(id) {
            break;
        }
        out.push(id);
        cur = ents.get(&id).and_then(|e| e.parent_id);
    }
    out
}

/// 把 `root` 的全部后代加入 `ids`(不含 `root` 自己);visited 防环。
fn collect_descendants(root: i64, children: &HashMap<i64, Vec<i64>>, ids: &mut HashSet<i64>) {
    let mut stack = vec![root];
    let mut seen = HashSet::new();
    seen.insert(root);
    while let Some(id) = stack.pop() {
        for &c in children.get(&id).into_iter().flatten() {
            if seen.insert(c) {
                ids.insert(c);
                stack.push(c);
            }
        }
    }
}
