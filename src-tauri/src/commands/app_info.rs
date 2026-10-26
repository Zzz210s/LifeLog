use crate::db::library;
use crate::db::Db;
use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

/// 设置页「通用」分区需要的只读信息
#[derive(Serialize)]
pub struct DbInfo {
    /// 当前库的数据库文件绝对路径(多库:app_data_dir + 当前库目录 + 文件名)
    pub path: String,
    /// 当前库的显示名(设置页「通用」里展示,用户切库后立刻能看到用的是哪个库)
    pub library: String,
    /// 条目数:点/线重构后 = `COUNT(*) FROM points`(笔记 + 标签 + 名字点,spec §6.6 / §7.2)
    pub entities: u64,
}

/// 条目总数(全部点):设置页「条目 N 条」的唯一口径真源,便于单测
pub fn count_entities(conn: &Connection) -> Result<u64, String> {
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM points", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(n.max(0) as u64)
}

#[tauri::command]
pub fn get_db_info(app: AppHandle) -> Result<DbInfo, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    // 多库(2026-10-26):路径与名字都取自注册表的当前库 —— 切库后这里必须跟着变,
    // 否则设置页会一直显示旧库的路径(切库实测时踩到过)
    let (path, name) = match library::load(&dir)? {
        Some(reg) => match reg.find(&reg.current) {
            Some(lib) => (
                library::db_path(&dir, lib).to_string_lossy().to_string(),
                lib.name.clone(),
            ),
            None => (dir.join(library::LIB_DB_FILE).to_string_lossy().to_string(), String::new()),
        },
        None => (dir.join(library::LIB_DB_FILE).to_string_lossy().to_string(), String::new()),
    };
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let entities = count_entities(&conn)?;
    Ok(DbInfo { path, library: name, entities })
}

#[cfg(test)]
#[path = "app_info_tests.rs"]
mod app_info_tests;
