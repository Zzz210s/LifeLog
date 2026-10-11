//! 时间轴收敛引擎(设计 2026-10-12 §6 / 计划 T2;P0-8 安全阀):S1 树收敛的载具。
//!
//! 公开面只有 [`run`](CLI 与测试共用);S1 本体在 [`s1_tree`],三个 settings 键的路径改写在
//! [`settings_paths`]。安全阀内建,不靠调用方记:
//!  ① 默认 dry-run,`--apply` 才写;
//!  ② `--db` 路径不含 `_lifelog-snapshots` 时,须 `--apply --allow-live` 同时给;
//!  ③ `user_version` 必须 31;
//!  ④ `时间/日期` 子级必须全是 4 位年容器,否则拒绝;
//!  ⑤ 单事务(搬移 / 合并 / 设置改写 / FTS 重建同生共死);
//!  ⑥ 写完事务内自对账(十条对账 + 三条等价性),失败回滚;
//!  ⑦ `--apply` 前先 `VACUUM INTO` 一份写前快照。
//! 退出码:0 成功 / 2 参数或前置不满足 / 3 自对账失败(已回滚)。
use rusqlite::Connection;
use std::path::{Path, PathBuf};

pub mod s1_self_check;
pub mod s1_sql;
pub mod s1_tree;
pub mod settings_paths;

#[cfg(test)]
#[path = "tests.rs"]
mod tests;

#[cfg(test)]
#[path = "tests_support.rs"]
mod tests_support;

#[cfg(test)]
#[path = "tests_settings.rs"]
mod tests_settings;

#[cfg(test)]
#[path = "tests_guard.rs"]
mod tests_guard;

/// 本次要跑的阶段。`created-at`(S2)归后续任务,这里先只收 `tree`。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Tree,
}

impl Phase {
    /// 解析 `--phase` 的取值;未知取值返回 None(由 CLI 报错)
    pub fn parse(text: &str) -> Option<Phase> {
        matches!(text, "tree").then_some(Phase::Tree)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Phase::Tree => "tree",
        }
    }
}

/// CLI 参数(与 `bin/time-axis-ops.rs` 一一对应;`--db` 必填,不设默认值)
#[derive(Debug, Clone)]
pub struct Opts {
    pub db: PathBuf,
    pub phase: Phase,
    pub apply: bool,
    pub allow_live: bool,
}

/// 失败:退出码 + 中文原因(CLI 原样打印)
#[derive(Debug, Clone)]
pub struct Failure {
    pub code: i32,
    pub message: String,
}

impl Failure {
    /// 参数 / 前置不满足(码 2)
    pub fn usage(msg: impl Into<String>) -> Self {
        Failure {
            code: 2,
            message: msg.into(),
        }
    }

    /// 自对账失败(码 3;调用方已回滚)
    pub fn check(msg: impl Into<String>) -> Self {
        Failure {
            code: 3,
            message: msg.into(),
        }
    }
}

/// 引擎入口:路径与版本闸门 -> 只读计划 -> dry-run 打印,或单事务执行 + 自对账。
/// 返回逐行中文报告(调用方直接打印);失败给退出码与原因。
pub fn run(opts: &Opts) -> Result<Vec<String>, Failure> {
    guard_path(&opts.db, opts.apply, opts.allow_live)?;
    let mut conn = Connection::open(&opts.db)
        .map_err(|e| Failure::usage(format!("打开库失败 {}: {e}", opts.db.display())))?;
    // 触发器会调 `tag_plain` / `entity_name` / `entity_key` 等连接级标量函数,必须先挂上
    crate::db::sql_functions::register(&conn).map_err(|e| Failure::check(e.to_string()))?;
    guard_version(&conn)?;
    let plan = s1_tree::plan(&conn)?;
    if !opts.apply {
        return Ok(plan.describe());
    }
    let snapshot = snapshot_before_write(&conn, &opts.db)?;
    let mut out = s1_tree::apply(&mut conn, &plan)?;
    out.push(format!("写前快照: {}", snapshot.display()));
    Ok(out)
}

/// ②:只允许写 `_lifelog-snapshots` 下的副本(`--allow-live` 留给真库阶段)。
fn guard_path(db: &Path, apply: bool, allow_live: bool) -> Result<(), Failure> {
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

/// ③:只处理 v31(表名 `points` / `lines` / `points_fts` 都由 031 建立)
fn guard_version(conn: &Connection) -> Result<(), Failure> {
    let uv: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| Failure::usage(format!("读 user_version 失败: {e}")))?;
    if uv != 31 {
        return Err(Failure::usage(format!(
            "user_version = {uv},本引擎只处理 v31"
        )));
    }
    Ok(())
}

/// ⑦:写前 `VACUUM INTO` 单文件快照(与 `scripts/entity-migration/snapshot.mjs` 同口径),
/// 命名 `<库名>.bak-pretimeaxis-<UTC 时间戳>`;已存在则拒绝覆盖。
fn snapshot_before_write(conn: &Connection, db: &Path) -> Result<PathBuf, Failure> {
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
