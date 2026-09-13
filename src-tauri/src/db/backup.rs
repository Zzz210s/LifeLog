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

/// 严格解析备份文件名,返回时间戳。
/// 只认 `<任意>.bak-<数字版本>-<YYYYmmddTHHMMSS>`:备份的 WAL/SHM 边车(`...-wal`/`-shm`)、
/// 手工副本(`...-manual`)与畸形名一律返回 None —— 既不参与保留排序,也不会被删。
fn backup_stamp(name: &str) -> Option<String> {
    let (head, stamp) = name.rsplit_once('-')?;
    let (_, version) = head.rsplit_once(".bak-")?;
    let bytes = stamp.as_bytes();
    let ok = all_digits(version.as_bytes())
        && bytes.len() == 15
        && bytes[8] == b'T'
        && all_digits(&bytes[..8])
        && all_digits(&bytes[9..]);
    ok.then(|| stamp.to_string())
}

/// 非空且全为 ASCII 数字
fn all_digits(bytes: &[u8]) -> bool {
    !bytes.is_empty() && bytes.iter().all(u8::is_ascii_digit)
}

/// 纯函数:算出应删除的备份文件名。
/// 只有严格命名的备份参与排序(见 backup_stamp),其它文件既不排序也不删除;
/// 时间戳格式固定(YYYYmmddTHHMMSS),字典序即时间序,故按时间戳降序保留最近 keep 份。
fn backups_to_prune(existing: Vec<String>, keep: usize) -> Vec<String> {
    let mut dated: Vec<(String, String)> = existing
        .into_iter()
        .filter_map(|n| backup_stamp(&n).map(|s| (n, s)))
        .collect();
    if dated.len() <= keep {
        return Vec::new();
    }
    dated.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.cmp(&a.0)));
    dated.split_off(keep).into_iter().map(|(n, _)| n).collect()
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

/// TRUNCATE 检查点:返回 busy 标志。busy 非 0 表示 WAL 没能截断,
/// 此时主库文件可能不含全部已提交内容,快照不完整(降级为告警,不阻断迁移)。
fn checkpoint_truncate(conn: &Connection) -> Result<i64, String> {
    let busy: i64 = conn
        .query_row("PRAGMA wal_checkpoint(TRUNCATE);", [], |r| r.get(0))
        .map_err(|e| format!("WAL 检查点失败: {e}"))?;
    if let Some(warning) = checkpoint_warning(busy) {
        eprintln!("{warning}");
    }
    Ok(busy)
}

/// busy 非 0 时的中文告警(None 表示 WAL 已截断,快照完整)
fn checkpoint_warning(busy: i64) -> Option<String> {
    (busy != 0).then(|| format!("警告: WAL 检查点 busy={busy},WAL 未截断,本次备份可能不含最新提交"))
}

/// 复制快照。复制中途失败会留下一个半截 `.bak`,而它名字与真备份完全同形,
/// 会被保留策略当成一份真备份并挤掉更早的快照 —— 所以先删掉再报错。
fn copy_snapshot(
    src: &Path,
    dest: &Path,
    copy: &dyn Fn(&Path, &Path) -> std::io::Result<u64>,
) -> Result<(), String> {
    match copy(src, dest) {
        Ok(_) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(dest);
            Err(format!("复制数据库失败: {e}"))
        }
    }
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
    checkpoint_truncate(conn)?;
    let stamp = utc_stamp(conn)?;
    let dest = dir.join(backup_name(file_name, from_version, &stamp));
    copy_snapshot(db_path, &dest, &|s, d| std::fs::copy(s, d))?;
    prune_backups(dir, &format!("{file_name}.bak-"));
    Ok(Some(dest))
}

#[cfg(test)]
#[path = "backup_tests.rs"]
mod backup_tests;
