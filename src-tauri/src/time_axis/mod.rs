//! 时间轴收敛引擎(设计 2026-10-12 §6 / 计划 T2 + T4;P0-8 安全阀)。
//!
//! 公开面只有 [`run`](CLI 与测试共用);S1 本体在 [`s1_tree`],S2 本体在 [`s2_created_at`],
//! 三个 settings 键的路径改写在 [`settings_paths`],安全阀在 [`guard`]。安全阀内建,不靠调用方记:
//!  ① 默认 dry-run,`--apply` 才写;
//!  ② `--db` 路径不含 `_lifelog-snapshots` 时,须 `--apply --allow-live` 同时给;
//!  ③ `user_version` 必须 31 或 32(032 只加索引与删 `lines.created_at`,与本引擎无关);
//!  ④ `时间/日期` 子级必须全是 4 位年容器,否则拒绝(S1);
//!  ⑤ 单事务(每阶段各自一个事务;`--phase both` 顺序跑 S1 再 S2);
//!  ⑥ 写完事务内自对账,失败回滚;
//!  ⑦ `--apply` 前先 `VACUUM INTO` 一份写前快照。
//! 退出码:0 成功 / 2 参数或前置不满足 / 3 自对账失败(已回滚)。
use rusqlite::Connection;
use std::path::PathBuf;

pub mod guard;
pub mod s1_self_check;
pub mod s1_sql;
pub mod s1_tree;
pub mod s2_created_at;
pub mod s2_sql;
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

#[cfg(test)]
#[path = "tests_s2.rs"]
mod tests_s2;

/// 本次要跑的阶段:`tree`(S1 树收敛)、`created-at`(S2 `created_at` 修复)、`both`(顺序串跑)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Tree,
    CreatedAt,
    Both,
}

impl Phase {
    /// 解析 `--phase` 的取值;未知取值返回 None(由 CLI 报错)
    pub fn parse(text: &str) -> Option<Phase> {
        match text {
            "tree" => Some(Phase::Tree),
            "created-at" => Some(Phase::CreatedAt),
            "both" => Some(Phase::Both),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Phase::Tree => "tree",
            Phase::CreatedAt => "created-at",
            Phase::Both => "both",
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

/// 引擎入口:路径与版本闸门 -> 写前快照(仅 apply) -> 按 `--phase` 分派 -> 汇总逐行中文报告。
pub fn run(opts: &Opts) -> Result<Vec<String>, Failure> {
    guard::guard_path(&opts.db, opts.apply, opts.allow_live)?;
    let mut conn = Connection::open(&opts.db)
        .map_err(|e| Failure::usage(format!("打开库失败 {}: {e}", opts.db.display())))?;
    // 触发器会调 `tag_plain` / `entity_name` / `entity_key` 等连接级标量函数,必须先挂上
    crate::db::sql_functions::register(&conn).map_err(|e| Failure::check(e.to_string()))?;
    guard::guard_version(&conn)?;
    let snapshot = if opts.apply {
        Some(guard::snapshot_before_write(&conn, &opts.db)?)
    } else {
        None
    };
    let mut out = Vec::new();
    if matches!(opts.phase, Phase::Tree | Phase::Both) {
        out.extend(run_tree(&mut conn, opts.apply)?);
    }
    if matches!(opts.phase, Phase::CreatedAt | Phase::Both) {
        out.extend(run_created_at(&mut conn, opts.apply)?);
    }
    if let Some(p) = snapshot {
        out.push(format!("写前快照: {}", p.display()));
    }
    Ok(out)
}

/// S1:只读计划 -> dry-run 打印,或单事务执行 + 自对账
fn run_tree(conn: &mut Connection, apply: bool) -> Result<Vec<String>, Failure> {
    let plan = s1_tree::plan(conn)?;
    if !apply {
        return Ok(plan.describe());
    }
    s1_tree::apply(conn, &plan)
}

/// S2:只读计划 -> dry-run 打印,或单事务执行 + 自对账
fn run_created_at(conn: &mut Connection, apply: bool) -> Result<Vec<String>, Failure> {
    let plan = s2_created_at::plan(conn)?;
    if !apply {
        return Ok(plan.describe());
    }
    s2_created_at::apply(conn, &plan)
}
