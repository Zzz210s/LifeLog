//! notes 流查询层(自 notes.rs 拆出以守 200 行上限):NoteFilter + query + count_tags
use super::{fold_tag_rows, map_note_row, Note};
use rusqlite::Connection;

/// 流查询条件:关键词 + 标签 AND + 分页排序
#[derive(Debug)]
pub struct NoteFilter {
    pub keyword: Option<String>,
    pub tags: Vec<String>,
    pub offset: i64,
    pub limit: i64,
    pub oldest_first: bool,
}

/// 按条件查询笔记流:
/// - keyword >=3 字符走 FTS MATCH(短语加引号防语法注入,尾缀 * 前缀匹配),content/tags 列皆可命中
/// - <3 字符退化 LIKE(SQLite 默认 ASCII 大小写不敏感),正文或任一标签**完整路径**命中即返回
/// - tags 为 AND 语义:每标签一个 EXISTS 子句(按 t.path 精确路径匹配,含子级开关属 MVP-3)
/// - 分页排序在 id 子查询内完成,外层仅做标签行折叠
pub fn query(conn: &Connection, f: &NoteFilter) -> rusqlite::Result<Vec<Note>> {
    let mut clauses: Vec<String> = Vec::new();
    let mut args: Vec<String> = Vec::new();
    let kw = f.keyword.as_deref().map(str::trim).filter(|k| !k.is_empty());
    if let Some(k) = kw {
        if k.chars().count() >= 3 {
            clauses.push(format!(
                "id IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?{})",
                args.len() + 1
            ));
            args.push(format!("\"{}\"*", k.replace('"', "\"\"")));
        } else {
            clauses.push(format!(
                "(content LIKE ?{n} OR EXISTS(SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id
                  WHERE l.target_type = 'note' AND l.target_id = notes.id AND t.path LIKE ?{n}))",
                n = args.len() + 1
            ));
            args.push(format!("%{}%", k));
        }
    }
    for name in &f.tags {
        clauses.push(format!(
            "EXISTS(SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id
             WHERE l.target_type = 'note' AND l.target_id = notes.id AND t.path = ?{})",
            args.len() + 1
        ));
        args.push(name.clone());
    }
    let cond = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    let dir = if f.oldest_first { "ASC" } else { "DESC" };
    let limit = if f.limit <= 0 { 50 } else { f.limit };
    let (li, oi) = (args.len() + 1, args.len() + 2);
    args.push(limit.to_string());
    args.push(f.offset.max(0).to_string());
    let sql = format!(
        "SELECT n.id, n.content, n.created_at, t.path
         FROM notes n
         LEFT JOIN tag_links l ON l.target_type = 'note' AND l.target_id = n.id
         LEFT JOIN tags t ON t.id = l.tag_id
         WHERE n.id IN (SELECT id FROM notes {cond} ORDER BY id {dir} LIMIT ?{li} OFFSET ?{oi})
         ORDER BY n.id {dir}, t.path"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(args), map_note_row)?;
    fold_tag_rows(rows)
}

/// 标签使用计数(仅统计 note 链接)返回**完整路径**:按次数降序,同数按路径升序。
/// 查询失败静默吞为空表(unwrap_or_default):筛选栏拿不到数据不阻断主界面,代价是错误被掩盖。
pub fn count_tags(conn: &Connection) -> Vec<(String, i64)> {
    conn.prepare(
        "SELECT t.path, COUNT(*) FROM tag_links l JOIN tags t ON t.id = l.tag_id
         WHERE l.target_type = 'note' GROUP BY t.path ORDER BY COUNT(*) DESC, t.path",
    )
    .and_then(|mut stmt| {
        let rows =
            stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })
    .unwrap_or_default()
}

#[cfg(test)]
#[path = "notes_query_tests.rs"]
mod notes_query_tests;
