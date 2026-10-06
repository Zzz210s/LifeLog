//! 标签关系的批量只读(设计 2026-10-06 §7 / 计划 Task 1 §5):
//! 侧栏树行小字、悬浮卡片与关系图都要按标签读全部出边。后端另有逐标签读数
//! (`list_tag_relations`)，但扁平模式 741 个标签会打约 1.5k 次 IPC；这里一次返回全量事实。
//!
//! 命中范围与逐标签读数完全一致:读 `tag_links` 的 `target_type='tag'` 行，
//! 每条事实的 relations 按目标路径升序;没有任何关系的标签不出现在结果里(前端查不到即空)。
use rusqlite::Connection;
use serde::Serialize;
use std::collections::BTreeMap;

use super::relation::{relation_ref, RelationRef};

/// 一个标签的事实;没有出边的标签不出现在结果里(前端查不到即空)
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TagFact {
    pub tag_id: i64,
    /// 该标签的全部出边(A → ?)，按目标路径升序;每项含显示的 name 与 remark
    pub relations: Vec<RelationRef>,
}

/// 批量事实包(IPC `list_tag_facts`):一次取全，省 1.5k 次往返
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TagFactsBundle {
    pub facts: Vec<TagFact>,
}

/// 全量标签关系事实(一次查询给全库);按 tag_id 升序
pub fn tag_facts(conn: &Connection) -> rusqlite::Result<TagFactsBundle> {
    let mut by_tag: BTreeMap<i64, TagFact> = BTreeMap::new();
    let mut stmt = conn.prepare(
        "SELECT l.tag_id, t.id, t.path FROM tag_links l JOIN tags t ON t.id = l.target_id \
         WHERE l.target_type = 'tag' ORDER BY l.tag_id, t.path",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?))
    })?;
    for row in rows {
        let (tag_id, to_tag_id, path) = row?;
        by_tag
            .entry(tag_id)
            .or_insert_with(|| TagFact { tag_id, relations: Vec::new() })
            .relations
            .push(relation_ref(to_tag_id, &path));
    }
    Ok(TagFactsBundle { facts: by_tag.into_values().collect() })
}

#[cfg(test)]
#[path = "facts_tests.rs"]
mod facts_tests;
