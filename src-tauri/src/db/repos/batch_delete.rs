//! 批量删除的仓库层(spec 2026-10-17 §4.3 / §6):写前 `VACUUM INTO` 快照 -> 单事务删 -> 一次 `gc_orphans`。
//!
//! 快照必须在**事务外**做(SQLite 的 VACUUM 不能在事务里跑);快照失败则整批不删。
//! 删除口径与单条 `notes::delete` 一致:按 id 删行,收尾回收因之失去全部引用的树内空壳标签。
use crate::db::repos::tags::gc_orphans;
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};

/// 取时间戳的 SQL(UTC `YYYYMMDDTHHMMSS`,与 `time_axis` 同口径)
pub const STAMP_SQL: &str = "SELECT strftime('%Y%m%dT%H%M%S','now')";

/// 批量删除读数:实际删掉的行数 + 快照绝对路径。
#[derive(Debug, PartialEq, Eq)]
pub struct DeletedMany {
    pub deleted: i64,
    pub snapshot: PathBuf,
}

/// 快照文件名:(`batch-delete-<stamp>.db`);已存在则依次补 `-2` / `-3`
/// (`VACUUM INTO` 拒绝覆盖已存在文件,同名冲突不能听天由命)。
pub fn snapshot_path(dir: &Path, stamp: &str) -> PathBuf {
    let first = dir.join(format!("batch-delete-{stamp}.db"));
    if !first.exists() {
        return first;
    }
    let mut n = 2u32;
    loop {
        let cand = dir.join(format!("batch-delete-{stamp}-{n}.db"));
        if !cand.exists() {
            return cand;
        }
        n += 1;
    }
}

/// 批量删除(快照 + 单事务):返回删除读数与快照路径。快照失败 -> 中文错,一条不删。
pub fn delete_many(conn: &mut Connection, ids: &[i64], dir: &Path) -> Result<DeletedMany, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("快照目录创建失败：{e}"))?;
    let stamp: String = conn
        .query_row(STAMP_SQL, [], |r| r.get(0))
        .map_err(|e| format!("取时间戳失败：{e}"))?;
    let out = snapshot_path(dir, &stamp);
    conn.execute("VACUUM INTO ?1", params![out.to_string_lossy()])
        .map_err(|e| format!("写前快照失败，已取消删除：{e}"))?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut deleted = 0i64;
    for id in ids {
        deleted += tx
            .execute("DELETE FROM points WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())? as i64;
    }
    gc_orphans(&tx).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(DeletedMany { deleted, snapshot: out })
}

#[cfg(test)]
#[path = "batch_delete_tests.rs"]
mod batch_delete_tests;
