//! 批量编辑命令层(spec 2026-10-17 §10.1):只做参数校验与转调仓库层。
//! 批量写(加 / 去标签、删除)的事务语义全在仓库层,失败整批回滚;本层不做半事务拼装。
use crate::commands::tags::with_conn;
use crate::db::repos::batch_delete::delete_many;
use crate::db::repos::batch_ids::filter_ids;
use crate::db::repos::batch_tag::{add_tag, remove_tag};
use crate::db::repos::notes::FilterConditions;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// 删除前的写前快照目录(spec §6.3):机器级约定路径;测试/排查可用环境变量覆盖。
pub const SNAPSHOT_DIR: &str = "F:/0-code/_lifelog-snapshots";
/// 快照目录的环境变量覆盖名(只给测试与排查用,不进设置页)。
const SNAPSHOT_DIR_ENV: &str = "LIFELOG_SNAPSHOT_DIR";

/// 批量加标签回执:`added` 新建线数,`existed` 已有 / 跳过数。
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TagPointsReport {
    pub added: i64,
    pub existed: i64,
}

/// 批量去标签回执:`removed` 删掉的无名字线数,`kept_named` 原样保留的名线数。
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UntagPointsReport {
    pub removed: i64,
    pub kept_named: i64,
}

/// 批量删除回执:实际删掉的行数 + 写前快照绝对路径。
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeletePointsReport {
    pub deleted: i64,
    pub snapshot: String,
}

/// 批量加标签:单事务幂等;目标必须是**已存在的标签**(不存在 / 传笔记 id 都给中文错)。
#[tauri::command]
pub fn tag_points(app: AppHandle, points: Vec<i64>, target: i64) -> Result<TagPointsReport, String> {
    with_conn(&app, |c| {
        add_tag(c, &points, target).map(|r| TagPointsReport { added: r.added, existed: r.existed })
    })
}

/// 批量去标签:只删无名字线;指向同目标的名线原样保留并由 `keptNamed` 回报。
#[tauri::command]
pub fn untag_points(
    app: AppHandle,
    points: Vec<i64>,
    target: i64,
) -> Result<UntagPointsReport, String> {
    with_conn(&app, |c| {
        remove_tag(c, &points, target)
            .map(|r| UntagPointsReport { removed: r.removed, kept_named: r.kept_named })
    })
}

/// 快照目录选择(纯函数,便于单测):环境变量 > 约定目录(可创建)> 数据库目录兜底。
fn resolve_snapshot_dir(env: Option<String>, prefer: &Path, fallback: PathBuf) -> PathBuf {
    if let Some(dir) = env.filter(|d| !d.trim().is_empty()) {
        return PathBuf::from(dir);
    }
    if std::fs::create_dir_all(prefer).is_ok() {
        return prefer.to_path_buf();
    }
    fallback
}

/// 快照目录:约定目录不可用(无权限 / 盘符不存在)时退回数据库所在目录。
fn snapshot_dir(app: &AppHandle) -> PathBuf {
    let fallback = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    resolve_snapshot_dir(std::env::var(SNAPSHOT_DIR_ENV).ok(), Path::new(SNAPSHOT_DIR), fallback)
}

/// 批量删除:写前快照 + 单事务删 + 收尾 gc;快照失败则整批不删(中文错)。
#[tauri::command]
pub fn delete_points(app: AppHandle, ids: Vec<i64>) -> Result<DeletePointsReport, String> {
    if ids.is_empty() {
        return Err("没有选中任何条目".into());
    }
    let dir = snapshot_dir(&app);
    with_conn(&app, |c| {
        delete_many(c, &ids, &dir).map(|r| DeletePointsReport {
            deleted: r.deleted,
            // 回报路径统一成 `/` 分隔(库里/回执里混 `\` 会让用户复制走不通;
            // Windows 两种写法都能开,只是显示一致性)
            snapshot: r.snapshot.to_string_lossy().replace('\\', "/"),
        })
    })
}

/// 「全选筛选结果」:当前条件下全部命中 id(一条命令一次拿全,谓词与信息流同一真源)。
#[tauri::command]
pub fn filter_point_ids(
    app: AppHandle,
    conditions: FilterConditions,
) -> Result<Vec<i64>, String> {
    crate::db::repos::notes::validate_conditions(&conditions)?;
    with_conn(&app, |c| filter_ids(c, &conditions))
}

#[cfg(test)]
#[path = "batch_tests.rs"]
mod batch_tests;
