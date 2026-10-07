//! 升级回归基线(spec §5.3 / 计划 T0.2)。
//!
//! 目的:把「迁移前」的正文解析结果冻结成 `fixtures/upgrade-regression.baseline.json`,
//! 阶段 4 的新实现对其逐字节比对(表层语法零变更,所以这是防止顺手改坏的回归网)。
//!
//! 解析一律复用产品实现:`tags::extract_tags_known`(严格,不带库内兜底)与
//! `links::{link_spans, title_of, display_title}` —— 本模块**不实现第二套语法**。
//! 基线不存正文,只存 `content_sha256` + 三元组 + 三元组摘要 `sha256`
//! (公开仓库:真库正文与其首行都属于用户内容,不入库;向量是合成/边界语料)。
//! 真库补充基线用 `gen-upgrade-baseline -- --db <真库>` 生成,落到仓库外的快照区
//! `F:\0-code\_lifelog-snapshots\upgrade-baseline-real-<stamp>.json`,与仓库分支线 diff 时用。
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// 一条回归输入:`why` 是文档字段,`content` 是待解析正文
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Case {
    pub why: String,
    pub content: String,
}

/// 一条基线:正文摘要 + 解析三元组(标签集合 / 链接 raw_title 序列 / 标题)+ 三元组摘要
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BaselineEntry {
    /// 来源:`fixture`(仓库内公开向量)或 `db`(真库只读抽样)
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

/// 解析一篇正文并组装基线条目
pub fn entry_from(content: &str, source: &str, why: &str) -> BaselineEntry {
    let (tags, links, title, display_title) = parse_content(content);
    let sha256 = triple_sha(&tags, &links, &title, &display_title);
    BaselineEntry {
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
