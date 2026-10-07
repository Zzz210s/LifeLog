//! 维护类 IPC(命令面板的两条副作用,设计 §3.7):
//! `rebuild_search_index`(重建全文索引)与 `quit_app`(退出应用)。
//! 两条都复用既有实现,不在前端另造一套:退出走 `windowing::events::quit`(与托盘「退出」同路径),
//! 重建走与迁移 026 完全相同的聚合口径(见 `rebuild` 注释)。
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

/// 幂等整体重建:DELETE 起手,再由 `entities` 全表回填 `entities_fts`。
///
/// 聚合口径的唯一真源是 [`crate::db::repos::entities::fts::ENTITIES_AGG`]
/// (阶段 4 起 027 的 9 个触发器也引用同一段表达式;026 的过渡视图 `entities_fts_src`
/// 已随 027 下架)。直接 `INSERT ... SELECT` 等于跑一遍整体重建,
/// 故本命令是「索引与正文疑似不一致」时的自愈入口。
///
/// 两条语句必须在同一事务内(与 `migrate::apply` 同口径的 `unchecked_transaction`):
/// 进程死在两条之间会留下空 `entities_fts`,3 字以上关键词会静默搜不到。
pub fn rebuild(conn: &rusqlite::Connection) -> rusqlite::Result<usize> {
    use crate::db::repos::entities::fts::ENTITIES_AGG;
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM entities_fts", [])?;
    let written = tx.execute(
        &format!(
            "INSERT INTO entities_fts(rowid, name, content, tag_paths)
             SELECT e.id, COALESCE(e.name, ''), e.content, {ENTITIES_AGG} FROM entities e"
        ),
        [],
    )?;
    tx.commit()?;
    Ok(written)
}

#[cfg(test)]
#[path = "maintenance_tests.rs"]
mod maintenance_tests;
