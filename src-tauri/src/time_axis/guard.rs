//! 时间轴收敛引擎的安全阀(自 `mod.rs` 拆出以守 200 行上限):路径闸门、版本闸门、写前快照。
//! 与具体阶段(S1/S2)无关,两个阶段共用同一套前置。
use super::Failure;
use rusqlite::Connection;
use std::path::{Path, PathBuf};

/// ②:只允许写 `_lifelog-snapshots` 下的副本(`--allow-live` 留给真库阶段)。
pub(crate) fn guard_path(db: &Path, apply: bool, allow_live: bool) -> Result<(), Failure> {
    if !apply || allow_live {
        return Ok(());
    }
    let path = db.to_string_lossy();
    if path.contains("_lifelog-snapshots") {
        return Ok(());
    }
    Err(Failure::usage(format!(
        "拒绝写非快照库 {path}:--apply 只允许写 `_lifelog-snapshots` 下的副本(真库阶段需 --allow-live)"
    )))
}

/// ③:只处理 v31 / v32(表名 `points` / `lines` / `points_fts` 都由 031 建立;
/// 032 只加 `idx_points_parent` 与删 `lines.created_at`,本引擎两样都不碰)
pub(crate) fn guard_version(conn: &Connection) -> Result<(), Failure> {
    let uv: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| Failure::usage(format!("读 user_version 失败: {e}")))?;
    if uv != 31 && uv != 32 {
        return Err(Failure::usage(format!(
            "user_version = {uv},本引擎只处理 v31 / v32"
        )));
    }
    Ok(())
}

/// ⑦:写前 `VACUUM INTO` 单文件快照(与 `scripts/entity-migration/snapshot.mjs` 同口径),
/// 命名 `<库名>.bak-pretimeaxis-<UTC 时间戳>`;已存在则拒绝覆盖。
pub(crate) fn snapshot_before_write(conn: &Connection, db: &Path) -> Result<PathBuf, Failure> {
    let stamp: String = conn
        .query_row("SELECT strftime('%Y%m%dT%H%M%SZ','now')", [], |r| r.get(0))
        .map_err(|e| Failure::check(format!("取时间戳失败: {e}")))?;
    let name = db
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "lifelog.db".to_string());
    let out = db.with_file_name(format!("{name}.bak-pretimeaxis-{stamp}"));
    if out.exists() {
        return Err(Failure::usage(format!(
            "写前快照已存在,先归档:{}",
            out.display()
        )));
    }
    conn.execute("VACUUM INTO ?1", rusqlite::params![out.to_string_lossy()])
        .map_err(|e| Failure::check(format!("写前快照失败: {e}")))?;
    Ok(out)
}
