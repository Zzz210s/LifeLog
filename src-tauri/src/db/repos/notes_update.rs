//! notes 更新层(自 notes.rs 拆出以守 200 行上限):update/toggle_todo。
/// 链接为增量替换(未变化的标签链不动),收尾由 tags_tree 精确回收孤儿。
/// 时间标签由系统添加、不在正文里,替换语义下必须显式保留(否则编辑正文会丢时间标签)。
use super::{read_full, strip_tags};
use rusqlite::{params, Connection};

/// 替换笔记标签集合(事务内):路径经校验后建/复用节点并做增量链接,最后收窄回收孤儿。
/// tag_links 触发器负责将聚合结果同步进 FTS tags 列。
fn set_tags(tx: &rusqlite::Transaction<'_>, id: i64, paths: &[String]) -> rusqlite::Result<()> {
    crate::db::repos::tags_tree::link_paths(tx, id, paths)
}

/// 该笔记现存的时间标签路径(系统添加,不在正文里)。改期是在标签链接上做的,
/// 不经正文;正文编辑/勾选待办走替换语义时靠它把时间标签补回目标集合。
fn time_tag_paths(conn: &rusqlite::Connection, id: i64) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT t.path FROM tag_links l JOIN tags t ON t.id = l.tag_id
         WHERE l.target_type = 'note' AND l.target_id = ?1 AND {} ORDER BY t.path",
        crate::timetag::sql_is_time_path("t")
    ))?;
    let rows = stmt.query_map(params![id], |r| r.get(0))?;
    rows.collect()
}

/// 更新笔记正文(事务):剥离/提取标签后整条重存,链接为替换语义。
/// id 不存在返回 None;成功返回含全量标签的最新笔记。
pub fn update(conn: &mut Connection, id: i64, content: &str) -> rusqlite::Result<Option<super::Note>> {
    let mut names = crate::tags::extract_tags(content);
    let text = strip_tags(content);
    let tx = conn.transaction()?;
    // 时间标签不在正文里:先把库里现存的补进目标集合(正文里手写的按普通标签规则叠加)
    names.extend(time_tag_paths(&tx, id)?);
    let rows = tx.execute(
        "UPDATE notes SET content=?1, updated_at=datetime('now','localtime') WHERE id=?2",
        params![text, id],
    )?;
    if rows == 0 {
        return Ok(None); // 无该行:回滚空事务
    }
    set_tags(&tx, id, &names)?;
    let note = read_full(&tx, id)?;
    tx.commit()?;
    Ok(note)
}

/// 读取笔记当前标签的完整路径(树语义真源)。toggle 必须按路径往返:
/// read_full 已改按 t.path 返回完整路径,此处同取路径,同名末级(不同父级)
/// 不会串到别的节点上。
fn tag_paths(conn: &rusqlite::Connection, id: i64) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT t.path FROM tag_links l JOIN tags t ON t.id = l.tag_id
         WHERE l.target_type='note' AND l.target_id=?1 ORDER BY t.path",
    )?;
    let rows = stmt.query_map(params![id], |r| r.get(0))?;
    rows.collect()
}

/// 把(可能含存量不可解析 path 的)标签路径集合解析成 tag id 集合。
/// 可解析的 path 走 ensure_path;存量名(v1.0、看电影.、a·b、含空格/含 '/')沿用既有 tag_id。
fn resolve_ids(conn: &rusqlite::Connection, paths: &[String]) -> rusqlite::Result<Vec<i64>> {
    let mut ids: Vec<i64> = Vec::new();
    for p in paths {
        let id = crate::db::repos::tags_tree::resolve_id(conn, p)?;
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    Ok(ids)
}

/// 切换 #todo/#done:含 todo 换 done,含 done 换 todo,均无则原样返回不写库。
/// 仅改标签集合,正文字节不动;id 不存在返回 None。
/// 存量标签的 path 不可解析(006 原样保留),故不走带校验的 set_tags,改为按 id 替换链接。
pub fn toggle_todo(conn: &mut Connection, id: i64) -> rusqlite::Result<Option<super::Note>> {
    let current = match read_full(conn, id)? {
        Some(n) => n,
        None => return Ok(None),
    };
    let mut tags = tag_paths(conn, id)?;
    if tags.iter().any(|t| t == "todo") {
        tags.retain(|t| t != "todo");
        tags.push("done".to_string());
    } else if tags.iter().any(|t| t == "done") {
        tags.retain(|t| t != "done");
        tags.push("todo".to_string());
    } else {
        return Ok(Some(current));
    }
    tags.sort(); // 与 read_full 的 ORDER BY t.path 序一致
    let tx = conn.transaction()?;
    let ids = resolve_ids(&tx, &tags)?;
    crate::db::repos::tags_tree::replace_links(&tx, id, &ids)?;
    let note = read_full(&tx, id)?;
    tx.commit()?;
    Ok(note)
}

#[cfg(test)]
#[path = "notes_update_tests.rs"]
mod notes_update_tests;

#[cfg(test)]
#[path = "notes_tree_edit_tests.rs"]
mod notes_tree_edit_tests;
