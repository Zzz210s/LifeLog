//! 标签「类型 / 携带」事实的批量只读(spec 2026-10-05 / 计划 Task 6 §5):
//! 侧栏树行徽章、携带小字与悬浮卡片都要按标签读类型与携带。后端另有逐标签读数
//! (`list_tag_types` / `list_tag_carries`),但扁平模式 768 个标签会打约 1.5k 次 IPC;
//! 这里一次返回全量事实 + 完整类型表,前端拿类型表把携带目标换算成「类型 -> 值」
//! (换算口径只在 `src/shared/tag-type-facts.ts` 一处,不在 Rust 再写一遍)。
//!
//! 命中范围与逐标签读数完全一致:左侧读 `tag_links` `target_type='type'`(类型认领),
//! 右侧读 `tag_links` `target_type='tag'`(携带),两侧都按 (tag_id, path) 排序。
use rusqlite::Connection;
use serde::Serialize;
use std::collections::BTreeMap;

use super::types::{leaf, list_types, TypeRef};

/// 一个标签的事实;既没有类型也没有携带的标签不出现在结果里(前端查不到即空)
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TagFact {
    pub tag_id: i64,
    /// 该标签认领的类型(按路径升序)
    pub types: Vec<TypeRef>,
    /// 该标签携带的目标标签路径(按路径升序,含历史未登记行)
    pub carried: Vec<String>,
}

/// 批量事实包:类型表是携带目标换算成「类型 -> 值」的依据,随事实一起给,省一次 IPC
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TagFactsBundle {
    pub types: Vec<TypeRef>,
    pub facts: Vec<TagFact>,
}

/// 全量标签事实(一次查询给全库);按 tag_id 升序
pub fn tag_facts(conn: &Connection) -> rusqlite::Result<TagFactsBundle> {
    let types = list_types(conn)?;
    let mut by_tag: BTreeMap<i64, TagFact> = BTreeMap::new();
    collect_types(conn, &mut by_tag)?;
    collect_carried(conn, &mut by_tag)?;
    Ok(TagFactsBundle { types, facts: by_tag.into_values().collect() })
}

/// 认领:'type' 行的 tag_id 是被认领(有类型)的标签,target_id 指向类型标签
fn collect_types(conn: &Connection, out: &mut BTreeMap<i64, TagFact>) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(
        "SELECT l.tag_id, rt.id, rt.path FROM tag_links l \
         JOIN tags rt ON rt.id = l.target_id \
         WHERE l.target_type = 'type' ORDER BY l.tag_id, rt.path",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?))
    })?;
    for row in rows {
        let (tag_id, type_tag_id, path) = row?;
        let name = leaf(&path);
        slot(out, tag_id).types.push(TypeRef { tag_id: type_tag_id, path, name });
    }
    Ok(())
}

/// 携带:tag_links.tag_id 是携带者,target_id 指向被携带的标签(只认 target_type='tag')
fn collect_carried(conn: &Connection, out: &mut BTreeMap<i64, TagFact>) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(
        "SELECT l.tag_id, t.path FROM tag_links l JOIN tags t ON t.id = l.target_id \
         WHERE l.target_type = 'tag' ORDER BY l.tag_id, t.path",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    for row in rows {
        let (tag_id, path) = row?;
        slot(out, tag_id).carried.push(path);
    }
    Ok(())
}

/// 取该标签的事实槽位,不存在则插入空槽
fn slot(out: &mut BTreeMap<i64, TagFact>, tag_id: i64) -> &mut TagFact {
    out.entry(tag_id).or_insert_with(|| TagFact { tag_id, types: Vec::new(), carried: Vec::new() })
}

#[cfg(test)]
#[path = "facts_tests.rs"]
mod facts_tests;
