//! 结构变更的路径派生与错误文案(自 tags_tree_ops.rs 拆出以守 200 行上限)。
use rusqlite::{params, Connection, OptionalExtension};

/// 从父节点派生新路径:无父 -> new_name;有父 -> 父 path + "/" + new_name。
/// 不能用节点自身旧 path 派生:存量平铺根的 path 可能不等于 name(006 原样保留含 '/'
/// 的名称,如 name=path='a/b'),自身派生的 'a/c' 会是一个并不存在的层级前缀 ——
/// 补全/全文索引/完整路径提示都会显示出这条幻影路径,要等某条笔记恰好写到它才自愈。
pub(crate) fn child_path(
    conn: &Connection,
    parent: Option<i64>,
    new_name: &str,
) -> rusqlite::Result<String> {
    match parent {
        None => Ok(new_name.to_string()),
        Some(p) => {
            let parent_path: String = conn
                .query_row("SELECT path FROM tags WHERE id = ?1", params![p], |r| r.get(0))
                .optional()?
                .ok_or_else(|| rusqlite::Error::InvalidParameterName(format!("父标签不存在: {p}")))?;
            Ok(format!("{parent_path}/{new_name}"))
        }
    }
}

/// 唯一索引(path 或同级 name)冲突映射成界面可读中文文案(Task 4 会直接展示),
/// 其余错误原样透出,避免把 sqlite 原生 `UNIQUE constraint failed` 文本暴露给用户。
pub(crate) fn unique_conflict(e: rusqlite::Error, text: &str) -> String {
    if e.to_string().contains("UNIQUE") {
        text.to_string()
    } else {
        e.to_string()
    }
}
