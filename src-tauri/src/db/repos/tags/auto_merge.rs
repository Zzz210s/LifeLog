//! 同父同名自动合并(设计 2026-10-06 §6 / 计划 T1.4)。
//! 触发点:任何标签写入收尾(`write::finish`)后,同一父下出现同名实体就整棵并。
//! v28 起是**三重闸门**(spec §3.6 / §10-P0-3):`is_cited=1` 与两侧 `meta` 单行,
//! 以及两侧 `meta` **逐字节相等**;且同父、`entity_key` 相等 —— `entity_key` 会折叠空白
//! 与 ASCII 大小写,故它只用于**分组**,逐字节相等用于**裁决**(真重复才合并)。
//! 幂等:再次触发时已无重名 -> 空操作。全程复用调用方事务,不自己开事务。
use super::merge::merge_core;
use super::tree::subtree_ids;
use rusqlite::{params, Connection, OptionalExtension};

/// 扫描并合并所有通过三重闸门的组(保留最小 id,其余按 id 升序并入),返回合并次数。
pub fn sweep(conn: &Connection) -> Result<usize, String> {
    let mut merged = 0usize;
    while let Some((source, target)) = next_duplicate(conn)? {
        merge_pair(conn, source, target)?;
        merged += 1;
    }
    Ok(merged)
}

/// 合并一对:先写 `entity_merge_log`(spec §10-P6,含被删侧 `meta` 快照)再走合并核心。
pub(crate) fn merge_pair(
    conn: &Connection,
    source_id: i64,
    target_id: i64,
) -> Result<(), String> {
    write_merge_log(conn, source_id, target_id)?;
    merge_core(conn, source_id, target_id, false)?;
    Ok(())
}

/// 写 `entity_merge_log`:源/目标实体 id、直接子实体 id 列表、`link` 入边数、`link` 边数、
/// 被删侧 `meta` 原文快照。与合并同一事务,失败一起回滚。
pub(crate) fn write_merge_log(
    conn: &Connection,
    source_id: i64,
    target_id: i64,
) -> Result<(), String> {
    let kids: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT id FROM entities WHERE parent_id = ?1 ORDER BY id")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![source_id], |r| r.get(0)).map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?
    };
    let note_links = note_links_of_subtree(conn, source_id)?;
    let edges: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM edges WHERE kind='link' AND (source_id=?1 OR target_id=?1)",
            params![source_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let meta_snapshot: String = conn
        .query_row("SELECT meta FROM entities WHERE id = ?1", params![source_id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO entity_merge_log(source_entity_id, target_entity_id, moved_child_ids, note_links, edges, meta_snapshot)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            source_id,
            target_id,
            serde_json::to_string(&kids).map_err(|e| e.to_string())?,
            note_links,
            edges,
            meta_snapshot
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 下一组待并:(source, target);无通过闸门的重名返回 None。保留组内 id 最小者为目标。
/// 三重闸门(spec §3.6):只在 `is_cited=1` 且 `meta` 单行的实体里,按「同父 + `entity_key`
/// + `meta` 逐字节相等」找重复组;多行(有正文)与未引用者一律不并。
pub(crate) fn next_duplicate(conn: &Connection) -> Result<Option<(i64, i64)>, String> {
    let group = conn
        .query_row(
            "SELECT COALESCE(parent_id, 0), entity_key(meta), meta
               FROM entities
              WHERE is_cited = 1 AND instr(meta, char(10)) = 0
              GROUP BY 1, 2, 3 HAVING COUNT(*) > 1
              ORDER BY MIN(id) LIMIT 1",
            [],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((parent, key, meta)) = group else {
        return Ok(None);
    };
    let mut stmt = conn
        .prepare(
            "SELECT id FROM entities
              WHERE COALESCE(parent_id, 0) = ?1 AND entity_key(meta) = ?2 AND meta = ?3
                AND is_cited = 1 AND instr(meta, char(10)) = 0
              ORDER BY id LIMIT 2",
        )
        .map_err(|e| e.to_string())?;
    let ids: Vec<i64> = stmt
        .query_map(params![parent, key, meta], |r| r.get(0))
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
        &format!("SELECT COUNT(*) FROM edges WHERE kind='link' AND target_id IN ({marks})"),
        rusqlite::params_from_iter(ids.iter()),
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}
