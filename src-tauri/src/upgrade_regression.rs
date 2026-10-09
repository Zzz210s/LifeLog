//! 升级回归基线(spec §5.3 / §7.5,计划 T0.2 -> T3.5)。
//!
//! 目的:把「当前实现」的正文解析结果冻结成 `fixtures/upgrade-regression.baseline.json`,
//! 后续阶段 4 的新实现对其逐条比对(表层语法零变更,所以这是防止顺手改坏的回归网)。
//!
//! 解析一律复用产品实现:`tags::extract_tags_known`(严格,不带库内兜底)与
//! `links::{link_spans, title_of, display_title}` —— 本模块**不实现第二套语法**。
//! 生成真源在 [`baseline`](迁移后:`{content, expect:{citations,title}}`,`citations` = `link` 边
//! 目标实体 id,现算自库而非现算自正文);旧形状 `LegacyEntry` 与冻结副本
//! `fixtures/upgrade-regression.baseline.legacy.json` 只作对照(spec §7.5)。
//! 真库补充基线用 `gen-upgrade-baseline -- --db <真库>` 生成,落到仓库外的快照区
//! `F:\0-code\_lifelog-snapshots\upgrade-baseline-real-<stamp>.json`,与仓库分支线 diff 时用。
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[path = "upgrade_regression_baseline.rs"]
pub mod baseline;

/// 一条回归输入:`why` 是文档字段,`content` 是待解析正文
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Case {
    pub why: String,
    pub content: String,
}

/// 迁移后基线的一条期望:`citations` = 该条正文落下的 `link` 边目标实体 id(按落库序),
/// `title` = `entity_name(meta)`(与旧基线的 `title` 同口径,逐条相等)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Expect {
    pub citations: Vec<i64>,
    pub title: String,
}

/// 迁移后基线的一条(冻结真源:基线条目一旦提交即冻结)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BaselineEntry {
    /// 来源:`fixture`(仓库内公开向量)或 `db`(真库只读抽样)
    pub source: String,
    pub why: String,
    /// 该条正文;fixture 条目本来就是公开向量,db 条目的输出只落仓库外快照区
    pub content: String,
    pub expect: Expect,
}

/// 旧形状(`*.baseline.legacy.json`):正文摘要 + 解析三元组(标签路径 / 链接 raw_title / 标题)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LegacyEntry {
    pub source: String,
    pub why: String,
    pub content_sha256: String,
    pub tags: Vec<String>,
    pub links: Vec<String>,
    pub title: String,
    pub display_title: String,
    pub sha256: String,
}

/// 三元组的规范形态:字段顺序即 JSON 键序,`sha256` 就是它的摘要
#[derive(Serialize)]
struct Triple<'a> {
    tags: &'a [String],
    links: &'a [String],
    title: &'a str,
    display_title: &'a str,
}

pub const SOURCE_FIXTURE: &str = "fixture";
pub const SOURCE_DB: &str = "db";

/// 小写十六进制
pub fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

pub fn sha256_hex(data: &[u8]) -> String {
    hex(&Sha256::digest(data))
}

/// 复用产品实现解析正文:(标签集合, 链接 raw_title 序列, title, display_title)
pub fn parse_content(content: &str) -> (Vec<String>, Vec<String>, String, String) {
    let tags = crate::tags::extract_tags_known(content, &[]);
    let links: Vec<String> = crate::links::link_spans(content)
        .into_iter()
        .map(|s| s.raw_title)
        .collect();
    let title = crate::links::title_of(content);
    let display_title = crate::links::display_title(content);
    (tags, links, title, display_title)
}

/// 三元组摘要:对规范 JSON 取 sha256(见 [`Triple`])
pub fn triple_sha(tags: &[String], links: &[String], title: &str, display_title: &str) -> String {
    let json = serde_json::to_string(&Triple { tags, links, title, display_title })
        .expect("三元组序列化不会失败");
    sha256_hex(json.as_bytes())
}

/// 解析一篇正文并组装**旧形状**条目(只服务 legacy 基线与对照断言)
pub fn entry_from(content: &str, source: &str, why: &str) -> LegacyEntry {
    let (tags, links, title, display_title) = parse_content(content);
    let sha256 = triple_sha(&tags, &links, &title, &display_title);
    LegacyEntry {
        source: source.to_string(),
        why: why.to_string(),
        content_sha256: sha256_hex(content.as_bytes()),
        tags,
        links,
        title,
        display_title,
        sha256,
    }
}

/// 读仓库内回归向量 `[{why, content}]`
pub fn load_cases(path: &std::path::Path) -> Result<Vec<Case>, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("读取 {path:?} 失败: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("解析 {path:?} 失败: {e}"))
}

/// 真库抽样的主类别(按优先级判一个),只用于覆盖统计与条目 `why`
pub fn categorize(content: &str, tags: &[String], links: &[String]) -> &'static str {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return "empty";
    }
    if trimmed.contains("```") || trimmed.contains("~~~") {
        return "fence";
    }
    if trimmed.lines().any(|l| {
        let t = l.trim();
        t.starts_with('|') && t.ends_with('|') && t.len() > 1
    }) {
        return "table";
    }
    if !tags.is_empty() && !links.is_empty() {
        return "tag+link";
    }
    if !links.is_empty() {
        return "link";
    }
    if !tags.is_empty() {
        let stripped = crate::db::repos::notes::notes_parse::strip_tags(content);
        return if stripped.trim().is_empty() { "tag-only" } else { "tag" };
    }
    if trimmed.contains('`') || trimmed.contains('\\') {
        return "escape";
    }
    "plain"
}

/// 真库抽样要覆盖的 7 个类别(向量与基线覆盖率断言共用)
pub const COVERED_CATEGORIES: [&str; 7] = [
    "plain", "tag", "tag-only", "link", "fence", "table", "empty",
];
