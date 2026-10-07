//! 同父同名自动合并(设计 2026-10-06 §6 / 计划 Task 2)。
//! 触发点:任何标签写入收尾(rename / move / delete / merge 都经 `finish`)后,
//! 同一父下出现**纯文本名**(`tag_plain`,避免 md 写法差异漏并)完全相同的标签就整棵并;
//! 拖入/改名撞上 raw 同名兄弟时由 ops 直接调 [`merge_pair`] 就地并。
//! 幂等:再次触发时已无重名 -> 空操作。全程复用调用方事务,不自己开事务。
use super::merge::merge_core;
use super::tree::subtree_ids;
use rusqlite::{params, Connection, OptionalExtension};

/// 扫描并合并所有「同父 + 纯文本同名」组(保留最小 id,其余按 id 升序并入),返回合并次数。
pub fn sweep(conn: &Connection) -> Result<usize, String> {
    let mut merged = 0usize;
    while let Some((source, target)) = next_duplicate(conn)? {
        merge_pair(conn, source, target)?;
        merged += 1;
    }
    Ok(merged)
}

/// 合并一对并先写 `entity_merge_log`(源/目标实体 id、直接子标签 id 列表、笔记链接数、关系边数)。
pub(crate) fn merge_pair(
    conn: &Connection,
    source_id: i64,
    target_id: i64,
) -> Result<(), String> {
    let kids: Vec<i64> = {
        let mut stmt = conn
            .prepare(
                "SELECT id FROM entities WHERE kind = 'tag' AND parent_id = ?1 ORDER BY id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![source_id], |r| r.get(0)).map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?
    };
    let note_links = note_links_of_subtree(conn, source_id)?;
    let edges: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM edges WHERE kind='relation' AND (source_id=?1 OR target_id=?1)",
            params![source_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO entity_merge_log(source_entity_id, target_entity_id, moved_child_ids, note_links, edges)
         VALUES(?1, ?2, ?3, ?4, ?5)",
        params![
            source_id,
            target_id,
            serde_json::to_string(&kids).map_err(|e| e.to_string())?,
            note_links,
            edges
        ],
    )
    .map_err(|e| e.to_string())?;
    merge_core(conn, source_id, target_id, false)?;
    Ok(())
}

/// 下一组待并:(source, target);无重名返回 None。保留同组里 id 最小者为目标。
fn next_duplicate(conn: &Connection) -> Result<Option<(i64, i64)>, String> {
    let group = conn
        .query_row(
            "SELECT COALESCE(parent_id, 0), tag_plain(name) FROM entities
             WHERE kind = 'tag'
             GROUP BY 1, 2 HAVING COUNT(*) > 1 LIMIT 1",
            [],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((parent, plain)) = group else {
        return Ok(None);
    };
    let mut stmt = conn
        .prepare(
            "SELECT id FROM entities
             WHERE kind = 'tag' AND COALESCE(parent_id, 0) = ?1 AND tag_plain(name) = ?2
             ORDER BY id",
        )
        .map_err(|e| e.to_string())?;
    let ids: Vec<i64> = stmt
        .query_map(params![parent, plain], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(ids.get(1).map(|source| (*source, ids[0])))
}

fn note_links_of_subtree(conn: &Connection, tag_id: i64) -> Result<i64, String> {
    let ids = subtree_ids(conn, tag_id).map_err(|e| e.to_string())?;
    if ids.is_empty() {
        return Ok(0);
    }
    let marks = vec!["?"; ids.len()].join(",");
    conn.query_row(
        &format!(
            "SELECT COUNT(*) FROM edges WHERE kind='tagging' AND target_id IN ({marks})"
        ),
        rusqlite::params_from_iter(ids.iter()),
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}
