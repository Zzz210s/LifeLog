//! 迁移前数据库备份:只在确实有迁移要跑时落一份可恢复快照。
//! 快照做法 = "WAL 截断检查点 + 复制主库文件"(不引入额外 crate 依赖);
//! 备份失败由调用方决定降级(不阻断迁移,只告警)。
use rusqlite::Connection;
use std::path::{Path, PathBuf};

/// 保留最近几份备份,超出部分删最旧
const KEEP_BACKUPS: usize = 3;

/// 备份文件名:`<库文件名>.bak-<迁移前版本>-<UTC 时间戳>`
fn backup_name(file_name: &str, from_version: i64, stamp: &str) -> String {
    format!("{file_name}.bak-{from_version}-{stamp}")
}

/// 取文件名里用于排序的时间戳(最后一个 '-' 之后的部分)
fn stamp_of(name: &str) -> &str {
    name.rsplit('-').next().unwrap_or(name)
}

/// 纯函数:算出应删除的备份文件名。
/// 时间戳格式固定(YYYYmmddTHHMMSS),字典序即时间序,故按时间戳降序保留最近 keep 份。
fn backups_to_prune(mut existing: Vec<String>, keep: usize) -> Vec<String> {
    if existing.len() <= keep {
        return Vec::new();
    }
    existing.sort_by(|a, b| stamp_of(b).cmp(stamp_of(a)));
    existing.split_off(keep)
}

/// 清理超出保留份数的旧备份;失败只告警,不影响本次备份可用性
fn prune_backups(dir: &Path, prefix: &str) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let existing: Vec<String> = entries
        .flatten()
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .filter(|n| n.starts_with(prefix))
        .collect();
    for name in backups_to_prune(existing, KEEP_BACKUPS) {
        if let Err(e) = std::fs::remove_file(dir.join(&name)) {
            eprintln!("警告: 旧备份 {name} 删除失败: {e}");
        }
    }
}

/// 由 SQLite 生成 UTC 时间戳(避免为格式化时间引入依赖)
fn utc_stamp(conn: &Connection) -> Result<String, String> {
    conn.query_row("SELECT strftime('%Y%m%dT%H%M%S', 'now')", [], |r| r.get(0))
        .map_err(|e| format!("取时间戳失败: {e}"))
}

/// 迁移前备份:调用方须先确认"有迁移要跑"。
/// 先做 TRUNCATE 检查点把 WAL 内容落进主库,再复制文件;成功返回快照路径。
pub fn backup_before_migration(
    conn: &Connection,
    db_path: &Path,
    from_version: i64,
) -> Result<Option<PathBuf>, String> {
    let dir = db_path
        .parent()
        .ok_or_else(|| "数据库路径没有父目录".to_string())?;
    let file_name = db_path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "数据库文件名无效".to_string())?;
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| format!("WAL 检查点失败: {e}"))?;
    let stamp = utc_stamp(conn)?;
    let dest = dir.join(backup_name(file_name, from_version, &stamp));
    std::fs::copy(db_path, &dest).map_err(|e| format!("复制数据库失败: {e}"))?;
    prune_backups(dir, &format!("{file_name}.bak-"));
    Ok(Some(dest))
}

#[cfg(test)]
#[path = "backup_tests.rs"]
mod backup_tests;
