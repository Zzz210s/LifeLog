//! 多库(项目)注册表:一个库 = 一个 SQLite 文件,列表存在应用级 `libraries.json`。
//!
//! 布局(2026-10-26 用户要求「可以弄多个库,目前的库命名为日常」):
//! ```text
//! <app_data_dir>/libraries.json          库列表 + 当前库 id
//! <app_data_dir>/libraries/<id>/lifelog.db
//! ```
//! 首次运行时把旧的单库 `<app_data_dir>/lifelog.db` 搬进 `libraries/richang/` 并命名为
//! 「日常」—— **先快照再搬**,任一步失败就回滚到原位,绝不让用户的数据卡在半个状态。
//!
//! 为什么"一库一文件"而不是加 `library_id` 列:后者要给既有上百处查询逐个补过滤,
//! 漏一处就串库(见设计讨论 Q1)。一库一文件让备份、快照、导出、迁移天然按库隔离。
//!
//! id 规则:`richang` 是旧库固定 id(迁移时生成);新库用 `lib-<时间戳>` —— **不用中文/用户输入**
//! 做目录名,避免 Windows 路径与大小写问题;显示名只存在于 json 里。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 注册表文件名(应用级,与库文件分开)
pub const REGISTRY_FILE: &str = "libraries.json";
/// 库文件在库目录里的名字(与旧的单库文件名一致,迁移时只是换个父目录)
pub const LIB_DB_FILE: &str = "lifelog.db";
/// 旧单库的固定 id(迁移进来的那个库)
pub const LEGACY_LIB_ID: &str = "richang";
/// 旧单库的显示名(用户要求)
pub const LEGACY_LIB_NAME: &str = "日常";
/// 库显示名长度上限(只做基本约束,不限制字符集)
const NAME_MAX: usize = 40;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryMeta {
    pub id: String,
    pub name: String,
    /// 相对 `<app_data_dir>` 的路径,便于整个目录搬走后仍能打开
    pub dir: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    pub current: String,
    pub libraries: Vec<LibraryMeta>,
}

impl Registry {
    /// 按 id 找库
    pub fn find(&self, id: &str) -> Option<&LibraryMeta> {
        self.libraries.iter().find(|l| l.id == id)
    }

    /// 按显示名找(重名检查用,大小写敏感 —— 与标签的"逐字节"口径一致)
    pub fn find_by_name(&self, name: &str) -> Option<&LibraryMeta> {
        self.libraries.iter().find(|l| l.name == name)
    }
}

/// 显示名规范化:去首尾空白、折叠内部空白;空名 / 超长 / 含控制字符一律拒
pub fn normalize_name(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("库名不能为空".into());
    }
    let folded = trimmed.split_whitespace().collect::<Vec<_>>().join(" ");
    if folded.chars().count() > NAME_MAX {
        return Err(format!("库名最多 {NAME_MAX} 个字"));
    }
    if folded.chars().any(|c| c.is_control()) {
        return Err("库名不能包含控制字符".into());
    }
    Ok(folded)
}

/// 时间戳(`YYYYMMDDTHHMMSS`),文件名与创建时间共用;不引第三方日期库
pub fn stamp_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (y, mo, d, h, mi, s) = civil_from_unix(secs);
    format!("{y:04}{mo:02}{d:02}T{h:02}{mi:02}{s:02}")
}

/// UNIX 秒 -> (年,月,日,时,分,秒) UTC;只用于生成 id/展示,不参与业务判断
fn civil_from_unix(secs: u64) -> (i64, u32, u32, u32, u32, u32) {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Howard Hinnant 的 civil_from_days
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = if m <= 2 { y + 1 } else { y };
    (
        year,
        m,
        d,
        (rem / 3_600) as u32,
        ((rem % 3_600) / 60) as u32,
        (rem % 60) as u32,
    )
}

/// 新库 id:时间戳 + 短后缀,避免同一秒建两个库撞名
pub fn new_lib_id(taken: &[LibraryMeta]) -> String {
    let base = format!("lib-{}", stamp_now());
    if !taken.iter().any(|l| l.id == base) {
        return base;
    }
    let mut n = 2;
    loop {
        let id = format!("{base}-{n}");
        if !taken.iter().any(|l| l.id == id) {
            return id;
        }
        n += 1;
    }
}

pub fn registry_path(app_dir: &Path) -> PathBuf {
    app_dir.join(REGISTRY_FILE)
}

/// 库文件绝对路径
pub fn db_path(app_dir: &Path, lib: &LibraryMeta) -> PathBuf {
    app_dir.join(&lib.dir).join(LIB_DB_FILE)
}

/// 读注册表;不存在返回 None(调用方走首次迁移)
pub fn load(app_dir: &Path) -> Result<Option<Registry>, String> {
    let p = registry_path(app_dir);
    if !p.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&p).map_err(|e| format!("读取库列表失败: {e}"))?;
    let reg: Registry = serde_json::from_str(&raw).map_err(|e| format!("库列表格式损坏: {e}"))?;
    if reg.libraries.is_empty() {
        return Err("库列表是空的(至少需要一个库)".into());
    }
    Ok(Some(reg))
}

/// 写注册表(先写临时文件再改名,避免写一半断电留下半个 json)
pub fn save(app_dir: &Path, reg: &Registry) -> Result<(), String> {
    let p = registry_path(app_dir);
    let tmp = p.with_extension("json.tmp");
    let body = serde_json::to_string_pretty(reg).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, body).map_err(|e| format!("写入库列表失败: {e}"))?;
    std::fs::rename(&tmp, &p).map_err(|e| format!("保存库列表失败: {e}"))
}

/// 库目录相对路径
pub fn rel_dir(id: &str) -> String {
    format!("libraries/{id}")
}

#[cfg(test)]
#[path = "library_tests.rs"]
mod library_tests;
