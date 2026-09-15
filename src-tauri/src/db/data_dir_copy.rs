//! 数据目录迁移的底层动作:决定哪些文件要搬、把 `-wal` 合并进主库、原子复制文件。
//!
//! 与 [`super::data_dir_migration`] 的分工:那边定义流程顺序与结果枚举,这边只做文件级动作。
//! 全部函数式(目录与路径都由调用方给出),便于用临时目录单测。

use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

/// 迁移前历史备份的统一前缀(`lifelog.db.bak-*`)
pub const BACKUP_PREFIX: &str = "lifelog.db.bak-";

/// 主库之外需要一起复制的文件。
///
/// 顺序:先 `-wal`(合并失败时才有),再 `-journal`。二者都属于旧库的「未落进主库的数据」,
/// 必须排在主库之前复制 —— 迁移靠「主库是否存在」判断已完成,附属文件不能晚于它。
pub fn sidecars_to_copy(old_db: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if !checkpoint_wal(old_db) {
        let wal = sidecar(old_db, "-wal");
        if wal.is_file() {
            files.push(wal);
        }
    }
    // 防御性:`-journal` 残留(异常退出留下的回滚日志)一并搬走,否则新库可能读出旧数据
    let journal = sidecar(old_db, "-journal");
    if journal.is_file() {
        files.push(journal);
    }
    files
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
pub fn backup_files(old_dir: &Path) -> Vec<PathBuf> {
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
pub fn copy_atomic(src: &Path, dest: &Path) -> Result<(), String> {
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
