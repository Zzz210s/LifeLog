pub mod backup;
pub mod backup_warning;
pub mod migrate;
pub mod repos;

use rusqlite::Connection;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// 全局共享 DB 连接(应用单用户,互斥锁足够)
pub struct Db(pub std::sync::Mutex<Connection>);

/// 打开成功时的读数:连接 + 迁移前备份信息
pub struct OpenReport {
    pub conn: Connection,
    /// 迁移前生成的备份路径(本次没有迁移要跑时为 None)
    pub backup: Option<PathBuf>,
    /// 有迁移要跑但备份失败的中文原因(迁移仍照常执行,由上层提示用户)
    pub backup_warning: Option<String>,
}

/// 打开/迁移失败时的读数:失败原因 + 失败前若已生成的备份
#[derive(Debug)]
pub struct OpenFailure {
    pub reason: String,
    pub backup: Option<PathBuf>,
}

impl OpenFailure {
    fn new(reason: String) -> Self {
        Self {
            reason,
            backup: None,
        }
    }
}

/// 备份动作:生产走 [`backup::backup_before_migration`],测试可注入失败版本
type BackupFn = dyn Fn(&Connection, &Path, i64) -> Result<Option<PathBuf>, String>;

/// 打开数据库并按 PRAGMA user_version 迁移。
/// 失败不 panic(用户只会看到闪退):返回带中文原因与已生成备份路径的 [`OpenFailure`],
/// 由 setup 弹对话框说明后以退出码 1 退出;备份失败不阻断迁移,以 backup_warning 返回。
pub fn open(path: &Path) -> Result<OpenReport, OpenFailure> {
    open_with(path, &backup::backup_before_migration)
}

fn open_with(path: &Path, backup_fn: &BackupFn) -> Result<OpenReport, OpenFailure> {
    let conn =
        Connection::open(path).map_err(|e| OpenFailure::new(format!("打开数据库文件失败: {e}")))?;
    let pragma = |e: rusqlite::Error| OpenFailure::new(format!("设置数据库参数失败: {e}"));
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(pragma)?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(pragma)?;
    conn.pragma_update(None, "busy_timeout", 3000)
        .map_err(pragma)?;
    let current: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| OpenFailure::new(format!("读取数据库版本失败: {e}")))?;
    let mut report = OpenReport {
        conn,
        backup: None,
        backup_warning: None,
    };
    // 仅在确实有迁移要跑时先落一份可恢复快照;备份失败只告警(迁移本身有事务兜底)
    if current < migrate::latest_version() {
        match backup_fn(&report.conn, path, current) {
            Ok(dest) => report.backup = dest,
            Err(e) => {
                eprintln!("警告: 迁移前数据库备份失败,继续执行迁移: {e}");
                report.backup_warning = Some(e);
            }
        }
    }
    if let Err(e) = migrate::run(&report.conn) {
        return Err(OpenFailure {
            reason: format!(
                "数据库迁移失败(原版本 {current} -> 最新 {}):{e}",
                migrate::latest_version()
            ),
            backup: report.backup,
        });
    }
    Ok(report)
}

/// 初始化结果:成功时可能带「迁移成功但备份失败」的警告
pub struct InitReport {
    pub backup_warning: Option<String>,
}

/// setup 阶段调用:创建数据目录、打开并迁移数据库、manage Db 连接。
/// 失败返回 [`OpenFailure`] 供上层弹中文对话框并退出,不做任何 panic。
pub fn init(app: &tauri::AppHandle) -> Result<InitReport, OpenFailure> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| OpenFailure::new(format!("定位应用数据目录失败: {e}")))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| OpenFailure::new(format!("创建应用数据目录失败: {e}")))?;
    let report = open(&dir.join("lifelog.db"))?;
    app.manage(Db(std::sync::Mutex::new(report.conn)));
    // 备份失败原因同时存入进程内提示槽:主窗加载后由 take_backup_warning 取一次,
    // 走错误条显示(不阻断;启动对话框覆盖主窗从未打开的情形)
    if let Some(warning) = &report.backup_warning {
        backup_warning::set(warning);
    }
    Ok(InitReport {
        backup_warning: report.backup_warning,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_sets_pragmas_and_migrates() {
        let dir = std::env::temp_dir().join(format!("lifelog-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = open(&dir.join("t.db")).unwrap().conn;
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

#[cfg(test)]
#[path = "open_failure_tests.rs"]
mod open_failure_tests;
