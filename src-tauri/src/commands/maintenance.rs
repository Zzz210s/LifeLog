//! 维护类 IPC(命令面板的两条副作用,设计 §3.7):
//! `rebuild_search_index`(重建全文索引)与 `quit_app`(退出应用)。
//! 两条都复用既有实现,不在前端另造一套:退出走 `windowing::events::quit`(与托盘「退出」同路径),
//! 重建走与迁移 011 完全相同的聚合口径(见 `rebuild` 注释)。
use crate::db::Db;
use crate::windowing;
use tauri::{AppHandle, Manager, State};

/// 重建全文索引,返回写入的索引行数(界面用它显示「已重建 N 条」)。
#[tauri::command]
pub fn rebuild_search_index(app: AppHandle) -> Result<usize, String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    rebuild(&conn).map_err(|e| e.to_string())
}

/// 退出应用:与托盘「退出」同一条路径(先把输入栏位置落库,再在后台线程宽限后退出)。
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    windowing::events::quit(&app);
}

/// 幂等整体重建:DELETE 起手,再由 notes 整表回填。
///
/// 聚合口径必须与迁移 011 重建的触发器逐字一致 —— `group_concat(t.path, ' ' ORDER BY t.path)`,
/// 无链接为空串(用 `path` 而非 `name`:树语义下真源是完整路径)。触发器已覆盖日常增删改,
/// 本命令是「索引与正文疑似不一致」时的自愈入口(见 `notes_fts` 为普通 FTS5 表的设计说明)。
pub fn rebuild(conn: &rusqlite::Connection) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM notes_fts", [])?;
    conn.execute(
        "INSERT INTO notes_fts(rowid, content, tags)
         SELECT n.id, n.content,
                COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path)
                          FROM tags t JOIN tag_links l ON l.tag_id = t.id
                          WHERE l.target_type = 'note' AND l.target_id = n.id), '')
         FROM notes n",
        [],
    )
}

#[cfg(test)]
#[path = "maintenance_tests.rs"]
mod maintenance_tests;
