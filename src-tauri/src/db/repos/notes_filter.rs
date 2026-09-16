//! 结构化筛选条件(前端 `filter-conditions.ts` 的等价定义)与"条件 -> SQL 片段"生成。
//! 真源是结构化条件对象(D6),而非表达式字符串;标签匹配一律参数占位 + `substr` 前缀,
//! 禁止 LIKE 通配符(标签名可能含 `%`/`_`)。LIKE 只用于既有行为中的短关键词子串匹配。
//! 谓词模板(标签/关键词/日期)抽到 [`filter_predicates`],与表达式编译器
//! [`crate::expr::compile`] 共用同一批实现 —— 两套输入,一套语义。
//! Serialize 派生供自建视图把条件落库为 JSON(views.rs),查询语义不变。
use rusqlite::types::Value;
use serde::{Deserialize, Serialize};

use crate::expr::ast::DateOp;

/// 共用谓词真源(与表达式编译器共享,杜绝第二套标签/日期/关键词语义)
#[path = "filter_predicates.rs"]
pub(crate) mod filter_predicates;
pub(crate) use filter_predicates::{date_predicate, keyword_predicate, tag_exists, tag_predicate};

/// 单个标签条件:完整路径 + 是否含子级(前端默认含子级)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct TagCond {
    pub path: String,
    pub include_children: bool,
}

/// 流查询条件对象;字段名与前端 `FilterConditions` 完全一致(JSON camelCase)。
/// `expr` 是附加的高级表达式条件(spec 3.3,默认 null):与结构化条件 AND 组合;
/// 文本非法时该条恒假(宁可查不到,也不放宽其余条件的语义)。
/// Serialize 供自建视图把条件对象落库为 JSON(views.rs),反序列化路径与语义不变。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct FilterConditions {
    pub keyword: Option<String>,
    pub tags: Vec<TagCond>,
    pub exclude_tags: Vec<TagCond>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub tag_presence: Option<String>,
    pub sort: Option<String>,
    pub expr: Option<String>,
}

/// 引入与排除标签各自的条数上限
const MAX_TAG_ITEMS: usize = 20;
/// 关键词长度上限(字符数)
const MAX_KEYWORD_CHARS: usize = 200;

/// 空条件(等价于"全部笔记,最新在前");与前端 `EMPTY_FILTER` 对应,
/// 生产反序列化缺字段时同样得到默认值,此包装主要供测试构造
#[allow(dead_code)]
pub fn empty() -> FilterConditions {
    FilterConditions::default()
}

/// 排序方向:仅显式 `oldest` 为最早在前,其余(含缺失)最新在前
pub fn oldest_first(c: &FilterConditions) -> bool {
    c.sort.as_deref() == Some("oldest")
}

/// "时间子树之外还有标签"的谓词(时间标签是系统元数据,不算用户的归类):
/// `any` = 存在该谓词,`none` = 不存在 —— 必须成对,否则只带时间标签的笔记两个条件都不命中。
fn has_custom_tag() -> String {
    format!(
        "EXISTS (SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id \
         WHERE l.target_type = 'note' AND l.target_id = n.id AND NOT ({}))",
        crate::timetag::sql_in_time_subtree("t")
    )
}

/// 条件 -> `WHERE` 之后的 SQL 片段与参数(固定以 `1=1` 起手,子句用 ` AND ` 连接)
pub fn where_clause(c: &FilterConditions) -> (String, Vec<Value>) {
    let mut args: Vec<Value> = Vec::new();
    let mut clauses: Vec<String> = Vec::new();
    if let Some(k) = c.keyword.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        clauses.push(keyword_predicate(k, &mut args));
    }
    for t in &c.tags {
        clauses.push(tag_exists(&tag_predicate(&t.path, !t.include_children, &mut args)));
    }
    for t in &c.exclude_tags {
        let m = tag_predicate(&t.path, !t.include_children, &mut args);
        clauses.push(format!("NOT {}", tag_exists(&m)));
    }
    match c.tag_presence.as_deref() {
        Some("any") => clauses.push(has_custom_tag()),
        Some("none") => clauses.push(format!("NOT ({})", has_custom_tag())),
        _ => {}
    }
    if let Some(f) = c.from.as_deref() {
        clauses.push(date_predicate(&DateOp::Ge, f, &mut args));
    }
    if let Some(t) = c.to.as_deref() {
        clauses.push(date_predicate(&DateOp::Le, t, &mut args));
    }
    // 表达式是最后一条附加条件:与前面所有结构化条件 AND 组合;文本非法则整条恒假
    if let Some(src) = c.expr.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        match crate::expr::validate(src) {
            Ok(ast) => clauses.push(crate::expr::compile(&ast, &mut args)),
            Err(_) => clauses.push("0=1".into()),
        }
    }
    let mut out = String::from("1=1");
    for cl in clauses {
        out.push_str(" AND");
        out.push(' ');
        out.push_str(&cl);
    }
    (out, args)
}

/// 校验(后端为唯一权威;前端只做即时提示):返回中文原因或 `Ok(())`
pub fn validate(c: &FilterConditions) -> Result<(), String> {
    let kw = c.keyword.as_deref().map(str::trim).unwrap_or("");
    if kw.chars().count() > MAX_KEYWORD_CHARS {
        return Err(format!("关键词最多 {MAX_KEYWORD_CHARS} 字"));
    }
    if c.tags.len() > MAX_TAG_ITEMS {
        return Err(format!("引入标签最多 {MAX_TAG_ITEMS} 项"));
    }
    if c.exclude_tags.len() > MAX_TAG_ITEMS {
        return Err(format!("排除标签最多 {MAX_TAG_ITEMS} 项"));
    }
    for t in c.tags.iter().chain(c.exclude_tags.iter()) {
        if crate::tags::parse_tag_path(&t.path).is_none() {
            return Err(format!("标签路径不合法: {}", t.path));
        }
    }
    if let Some(f) = c.from.as_deref() {
        if !crate::timetag::is_iso_date(f) {
            return Err("开始日期格式不正确(应为 YYYY-MM-DD)".into());
        }
    }
    if let Some(t) = c.to.as_deref() {
        if !crate::timetag::is_iso_date(t) {
            return Err("结束日期格式不正确(应为 YYYY-MM-DD)".into());
        }
    }
    if let (Some(f), Some(t)) = (c.from.as_deref(), c.to.as_deref()) {
        if f > t {
            return Err("开始日期不能晚于结束日期".into());
        }
    }
    if let Some(s) = c.sort.as_deref() {
        if s != "newest" && s != "oldest" {
            return Err("排序取值非法".into());
        }
    }
    if let Some(p) = c.tag_presence.as_deref() {
        if p != "any" && p != "none" {
            return Err("标签有无取值非法".into());
        }
    }
    // 附加表达式:空白视为未设置;非法时带原因与**字符位置**(1 起,便于界面提示)
    if let Some(src) = c.expr.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if let Err(e) = crate::expr::validate(src) {
            return Err(format!("表达式:{}(第 {} 个字符)", e.message, e.pos + 1));
        }
    }
    Ok(())
}
