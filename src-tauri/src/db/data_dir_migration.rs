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
//!    再把附属文件(`-wal` / `-journal` / `lifelog.db.bak-*`)复制到新目录,**最后**复制主库。
//!
//! 主库放在最后复制是**完成标记**:新目录里出现 `lifelog.db` 就代表整套文件都已复制完。
//! 若附属文件途中复制失败,新目录里没有主库,下次启动会重新尝试一次,而不是因为看见主库
//! 就误判「迁移已完成」、把 `-wal` 里未 checkpoint 的数据与备份永久丢下。
//!
//! 复制采用「先写 `.part` 临时文件再改名」,任一步失败都清掉临时文件,
//! 保证新目录里不会留下半成品(见 [`super::data_dir_copy`])。

use crate::db::data_dir_copy::{backup_files, clear_stale_sidecars, copy_atomic, sidecars_to_copy};
use std::fs;
use std::path::Path;
use tauri::Manager;

/// 数据库文件名(与 db::init / 备份命名保持一致)
pub const DB_FILE: &str = "lifelog.db";
/// 旧 identifier 决定的目录名(与新目录同级)
pub const OLD_DIR_NAME: &str = "app.lifelog";

/// 迁移结果(供 stderr 日志与测试断言)
#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    /// 新目录已有数据库,未做任何事
    AlreadyPresent,
    /// 新旧目录都没有数据库(全新安装)
    Fresh,
    /// 已把旧目录的文件复制到新目录,数量含主库、附属文件与历史备份
    Migrated { files: usize },
}

impl Outcome {
    pub fn describe(&self) -> String {
        match self {
            Outcome::AlreadyPresent => "新数据目录已有数据库,无需迁移".to_string(),
            Outcome::Fresh => "旧数据目录没有数据库,按全新安装处理".to_string(),
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
    // 顺序即语义:附属文件在前、主库在最后(主库存在 = 整套复制完成,见模块头注释)
    let mut sources = sidecars_to_copy(&old_db);
    sources.extend(backup_files(old_dir));
    sources.push(old_db);
    fs::create_dir_all(new_dir)
        .map_err(|e| format!("创建新数据目录失败({}):{e}", new_dir.display()))?;
    // 重试路径:先清掉新目录里本次不会写入的旧附属文件,避免过期 `-wal` 与新主库并存
    clear_stale_sidecars(new_dir, &sources)?;
    for src in &sources {
        let name = src
            .file_name()
            .ok_or_else(|| format!("源文件路径异常: {}", src.display()))?;
        copy_atomic(src, &new_dir.join(name))?;
    }
    Ok(Outcome::Migrated { files: sources.len() })
}
