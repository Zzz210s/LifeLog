//! 排序数据模型与「生效排序」的唯一入口(自 notes_filter.rs 拆出以守 200 行红线):
//! `SortCond` 与新字段 `sorts` 的形状、旧单值 `sort` 的合成回退、排序条件校验。
//! 与前端 `src/shared/filter-conditions.ts` 的 `SortCond` 联合一一对应(JSON camelCase)。
use super::notes_filter::FilterConditions;
use serde::{Deserialize, Serialize};

/// 排序条件条数上限(与前端 `MAX_SORT_CONDS` 一致)
pub const MAX_SORT_CONDS: usize = 5;

const DIR_DESC: &str = "desc";
const DIR_ASC: &str = "asc";

fn default_dir() -> String {
    DIR_DESC.to_string()
}
fn default_enabled() -> bool {
    true
}

/// 排序条件(有序数组元素,下标即优先级):时间(键是 `notes.id`)或标签轴子树(恒含子级)。
/// 缺 `enabled` 默认启用(手写 JSON 宽容);`dir` 缺失落 `desc`,由 [`validate_sorts`] 拦截不合法值。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SortCond {
    Time {
        #[serde(default = "default_dir")]
        dir: String,
        #[serde(default = "default_enabled")]
        enabled: bool,
    },
    Tag {
        path: String,
        #[serde(default = "default_dir")]
        dir: String,
        #[serde(default = "default_enabled")]
        enabled: bool,
    },
}

impl SortCond {
    /// 方向是否为降序(`desc` = 新 -> 旧 / 选项顺序;`asc` = 旧 -> 新 / 选项倒序)
    pub fn is_desc(&self) -> bool {
        match self {
            SortCond::Time { dir, .. } | SortCond::Tag { dir, .. } => dir != DIR_ASC,
        }
    }

    /// 是否参与 SQL(停用项保留在列表里但不排序)
    pub fn enabled(&self) -> bool {
        match self {
            SortCond::Time { enabled, .. } | SortCond::Tag { enabled, .. } => *enabled,
        }
    }
}

/// 生效排序的**唯一入口**:`sorts` 非空(含全停用)以它为准;
/// 否则由旧单值 `sort` 合成一条时间条件(空数组 = 默认时间降序,等价今天的 `newest`)。
pub fn effective_sorts(c: &FilterConditions) -> Vec<SortCond> {
    if !c.sorts.is_empty() {
        return c.sorts.clone();
    }
    vec![SortCond::Time {
        dir: if oldest_first(c) { DIR_ASC } else { DIR_DESC }.to_string(),
        enabled: true,
    }]
}

/// 旧单值 `sort` 的读法:仅显式 `oldest` 为最早在前,其余(含缺失)最新在前。
/// 保留为兼容位(见 `FilterConditions::sort`);新逻辑一律走 [`effective_sorts`]。
pub fn oldest_first(c: &FilterConditions) -> bool {
    c.sort.as_deref() == Some("oldest")
}

/// 排序条件校验(后端唯一权威):条数上限、方向取值、标签轴路径合法性
pub fn validate_sorts(c: &FilterConditions) -> Result<(), String> {
    if c.sorts.len() > MAX_SORT_CONDS {
        return Err(format!("排序条件最多 {MAX_SORT_CONDS} 条"));
    }
    for s in &c.sorts {
        let path = match s {
            SortCond::Time { dir, .. } => {
                if dir != DIR_ASC && dir != DIR_DESC {
                    return Err("排序方向非法".into());
                }
                None
            }
            SortCond::Tag { path, dir, .. } => {
                if dir != DIR_ASC && dir != DIR_DESC {
                    return Err("排序方向非法".into());
                }
                Some(path)
            }
        };
        if let Some(p) = path {
            if crate::tags::validate_tag_path(p).is_err() {
                return Err(format!("标签路径不合法: {p}"));
            }
        }
    }
    Ok(())
}
