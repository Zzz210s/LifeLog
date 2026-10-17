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

/// 幂等整体重建:DELETE 起手,再由视图 `points_fts_src` 全表回填 `points_fts`,
/// 收尾做 FTS 段整理 + `VACUUM`(2026-10-17 数据库体检报告 §1)。
///
/// 聚合口径的唯一真源是 Rust 常量 [`crate::db::repos::entities::fts::POINTS_AGG`];
/// 视图 `points_fts_src` 由迁移 031 的 v31 前置钩子从它拼出(16 个触发器也引用同一视图),
/// 故本命令与触发器具同一口径。直接 `INSERT ... SELECT` 等于跑一遍整体重建,
/// 故本命令是「索引与正文疑似不一致」时的自愈入口。纯名字点由视图排除,不进 FTS。
///
/// 三条语句必须在同一事务内(与 `migrate::apply` 同口径的 `unchecked_transaction`):
/// 进程死在 DELETE 与 INSERT 之间会留下空 `points_fts`,3 字以上关键词会静默搜不到。
/// 第三条 `optimize` 把本次重建产生的多个段合并成一段(体检:同内容 `points_fts_data`
/// 3,076,096 → 1,372,160 B),与段整理前比再省约 1.7 MB 死段。
///
/// `VACUUM` 在事务提交之后执行:SQLite 明确禁止在事务里 `VACUUM`(`cannot VACUUM from within
/// a transaction`)。调用点只持有 `db.0` 的连接锁(不是事务),故此处是 autocommit 上下文;
/// 没有空闲页时 `VACUUM` 只是重写一遍文件,幂等无害。
pub fn rebuild(conn: &rusqlite::Connection) -> rusqlite::Result<usize> {
    let written = {
        let tx = conn.unchecked_transaction()?;
        tx.execute("DELETE FROM points_fts", [])?;
        let written = tx.execute(
            "INSERT INTO points_fts(rowid, meta, paths)
             SELECT id, meta, paths FROM points_fts_src",
            [],
        )?;
        tx.execute("INSERT INTO points_fts(points_fts) VALUES('optimize')", [])?;
        tx.commit()?;
        written
    };
    conn.execute_batch("VACUUM")?;
    Ok(written)
}

#[cfg(test)]
#[path = "maintenance_tests.rs"]
mod maintenance_tests;

#[cfg(test)]
#[path = "maintenance_compact_tests.rs"]
mod maintenance_compact_tests;
