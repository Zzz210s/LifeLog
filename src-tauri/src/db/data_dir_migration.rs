//! identifier 由 `app.lifelog` 改为 `com.lifelog.app` 后的一次性数据目录迁移。
//!
//! 新旧目录是 `%APPDATA%` 下的同级目录,数据库文件名保持 `lifelog.db` 不变。
//! 迁移**只复制不移动**:旧目录原样保留作回退,所以任何一步失败都不会让用户失去数据;
//! 失败必须向上返回错误(绝不静默用空库继续,否则用户会以为数据丢了)。
//!
//! 步骤(见 spec 2026-09-15 第 3.1 节):
//! 1. 新目录已有 `lifelog.db` -> 幂等,什么都不做;
//! 2. 旧目录没有 `lifelog.db` -> 全新安装,什么都不做(让后续建库);
//! 3. 旧库存在 -> 先把待合并的 `-wal` 用 `wal_checkpoint(TRUNCATE)` 落进主库,
//!    再把 `lifelog.db` 与全部 `lifelog.db.bak-*` 复制到新目录。
//!
//! 复制采用「先写 `.part` 临时文件再改名」,任一步失败都清掉临时文件,
//! 保证新目录里不会留下半成品。

use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// 数据库文件名(与 db::init / 备份命名保持一致)
pub const DB_FILE: &str = "lifelog.db";
/// 旧 identifier 决定的目录名(与新目录同级)
pub const OLD_DIR_NAME: &str = "app.lifelog";
/// 迁移前历史备份的统一前缀(`lifelog.db.bak-*`)
const BACKUP_PREFIX: &str = "lifelog.db.bak-";

/// 迁移结果(供 stderr 日志与测试断言)
#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    /// 新目录已有数据库,未做任何事
    AlreadyPresent,
    /// 新旧目录都没有数据库(全新安装)
    Fresh,
    /// 已把旧目录的文件复制到新目录,数量含主库与历史备份
    Migrated { files: usize },
}

impl Outcome {
    pub fn describe(&self) -> String {
        match self {
            Outcome::AlreadyPresent => "新数据目录已有数据库,无需迁移".to_string(),
            Outcome::Fresh => "未发现旧数据目录,按全新安装处理".to_string(),
            Outcome::Migrated { files } => format!("已复制 {files} 个文件到新数据目录"),
        }
    }
}

/// 生产入口:由 app_data_dir(新目录)推出同级旧目录,执行迁移并写一行 stderr 日志。
pub fn migrate_for_app(app: &tauri::AppHandle) -> Result<Outcome, String> {
    let new_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("定位应用数据目录失败: {e}"))?;
    let old_dir = new_dir
        .parent()
        .map(|p| p.join(OLD_DIR_NAME))
        .ok_or_else(|| format!("无法由 {} 推出旧数据目录", new_dir.display()))?;
    let outcome = migrate(&new_dir, &old_dir)?;
    eprintln!(
        "数据目录迁移:{} -> {},{}",
        old_dir.display(),
        new_dir.display(),
        outcome.describe()
    );
    Ok(outcome)
}

/// 执行迁移。纯函数式:目录都由调用方给出,便于用临时目录测试。
pub fn migrate(new_dir: &Path, old_dir: &Path) -> Result<Outcome, String> {
    if new_dir.join(DB_FILE).is_file() {
        return Ok(Outcome::AlreadyPresent);
    }
    let old_db = old_dir.join(DB_FILE);
    if !old_db.is_file() {
        return Ok(Outcome::Fresh);
    }
    let mut sources = vec![old_db.clone()];
    if !checkpoint_wal(&old_db) {
        // 旧库被占用等导致无法合并 -wal:连 -wal 一起复制,避免丢已提交但未落盘的数据
        let wal = sidecar(&old_db, "-wal");
        if wal.is_file() {
            sources.push(wal);
        }
    }
    sources.extend(backup_files(old_dir));
    fs::create_dir_all(new_dir)
        .map_err(|e| format!("创建新数据目录失败({}):{e}", new_dir.display()))?;
    for src in &sources {
        let name = src
            .file_name()
            .ok_or_else(|| format!("源文件路径异常: {}", src.display()))?;
        copy_atomic(src, &new_dir.join(name))?;
    }
    Ok(Outcome::Migrated { files: sources.len() })
}

/// 把旧库待合并的 `-wal` 落进主库。返回是否「主库现已自足」。
///
/// 没有非空 `-wal` 时直接返回 true —— 既没东西可合并,也避免为一次空操作去碰旧目录。
/// 旧库打不开(被占用等)时不做任何修改,返回 false 交给上层按只读方式连 -wal 一起复制。
fn checkpoint_wal(old_db: &Path) -> bool {
    let wal = sidecar(old_db, "-wal");
    let has_pending = wal.is_file() && fs::metadata(&wal).map(|m| m.len()).unwrap_or(0) > 0;
    if !has_pending {
        return true;
    }
    let conn = match Connection::open(old_db) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("警告: 旧数据库被占用,无法合并 WAL,将连 -wal 一起复制: {e}");
            return false;
        }
    };
    match conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| r.get::<_, i64>(0)) {
        Ok(0) => true,
        Ok(busy) => {
            eprintln!("警告: 旧数据库 WAL 未能完全合并(busy={busy}),将连 -wal 一起复制");
            false
        }
        Err(e) => {
            eprintln!("警告: 旧数据库 WAL 合并失败,将连 -wal 一起复制: {e}");
            false
        }
    }
}

/// 由文件名拼出同名附属文件路径(如 `lifelog.db` + `-wal`)
fn sidecar(db: &Path, suffix: &str) -> PathBuf {
    let mut name = db.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

/// 旧目录里全部 `lifelog.db.bak-*` 文件(排序保证复制顺序稳定)
fn backup_files(old_dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(old_dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with(BACKUP_PREFIX))
        })
        .collect();
    files.sort();
    files
}

/// 复制到同目录下的 `.part` 临时文件再改名:任一步失败都清理临时文件,
/// 保证新目录里不会留下半成品。
fn copy_atomic(src: &Path, dest: &Path) -> Result<(), String> {
    let mut tmp_name = dest.as_os_str().to_owned();
    tmp_name.push(".part");
    let tmp = PathBuf::from(tmp_name);
    if let Err(e) = fs::copy(src, &tmp).and_then(|_| fs::rename(&tmp, dest)) {
        let _ = fs::remove_file(&tmp);
        return Err(format!(
            "复制失败 {} -> {}:{e}",
            src.display(),
            dest.display()
        ));
    }
    Ok(())
}
