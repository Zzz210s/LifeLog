pub mod backup;
pub mod migrate;
pub mod repos;

use rusqlite::Connection;
use std::path::Path;
use tauri::Manager;

/// 全局共享 DB 连接(应用单用户,互斥锁足够)
pub struct Db(pub std::sync::Mutex<Connection>);

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "busy_timeout", 3000)?;
    // 仅在确实有迁移要跑时先落一份可恢复快照;
    // 备份失败不阻断迁移(迁移本身有事务兜底),只打印中文警告
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if current < migrate::latest_version() {
        if let Err(e) = backup::backup_before_migration(&conn, path, current) {
            eprintln!("警告: 迁移前数据库备份失败,继续执行迁移: {e}");
        }
    }
    migrate::run(&conn)?;
    Ok(conn)
}

/// setup 阶段调用:创建数据目录并 manage Db
pub fn init(app: &tauri::AppHandle) -> tauri::Result<()> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| tauri::Error::Io(std::io::Error::other(e.to_string())))?;
    let conn = open(&dir.join("lifelog.db"))
        .map_err(|e| tauri::Error::Anyhow(e.into()))?;
    app.manage(Db(std::sync::Mutex::new(conn)));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_sets_pragmas_and_migrates() {
        let dir = std::env::temp_dir().join(format!("lifelog-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = open(&dir.join("t.db")).unwrap();
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode, "wal");
        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fk, 1);
    }
}
