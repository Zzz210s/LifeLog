//! notes 更新层(自 notes.rs 拆出以守 200 行上限):update/toggle_todo。
//! 链接为增量替换(未变化的标签链不动),收尾由 tags_tree 精确回收孤儿。
//! 时间标签已是普通标签(D3):不再有"系统添加必须保留"的特例 —— 编辑界面把标签
//! 回显为 `#tag` 文本,正文里带回来的标签就是最终集合(想去/改时间就改那段文本)。
use super::{read_full, strip_tags};
use rusqlite::{params, Connection};

/// 替换笔记标签集合(事务内):路径经校验后建/复用节点并做增量链接,最后收窄回收孤儿。
/// tag_links 触发器负责将聚合结果同步进 FTS tags 列。
fn set_tags(tx: &rusqlite::Transaction<'_>, id: i64, paths: &[String]) -> rusqlite::Result<()> {
    crate::db::repos::tags_tree::link_paths(tx, id, paths)
}

/// 更新笔记正文(事务):剥离/提取标签后整条重存,链接为替换语义。
/// id 不存在返回 None;成功返回含全量标签的最新笔记。
pub fn update(conn: &mut Connection, id: i64, content: &str) -> rusqlite::Result<Option<super::Note>> {
    let names = crate::tags::extract_tags(content);
    let text = strip_tags(content);
    let tx = conn.transaction()?;
    let rows = tx.execute(
        "UPDATE notes SET content=?1 WHERE id=?2",
        params![text, id],
    )?;
    if rows == 0 {
        return Ok(None); // 无该行:回滚空事务
    }
    // 审计:替换语义会把"正文里没出现的标签"一并移除 —— UI 编辑路径会回显全部标签所以正常不触发,
    // 但脚本/裸命令按正文重建内容时会静默抹掉标签(本库曾因此丢过 10 条笔记的标签,靠快照才发现)。
    // 这里只记一条日志,不改语义。
    let before = tag_paths(&tx, id)?;
    if names.len() < before.len() {
        eprintln!(
            "更新笔记 {id}: 标签 {} 条 -> {} 条,被移除的标签:{}",
            before.len(),
            names.len(),
            before.iter().filter(|p| !names.contains(p)).cloned().collect::<Vec<_>>().join(" ")
        );
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
