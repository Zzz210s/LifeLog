//! 结构化筛选条件(前端 `filter-conditions.ts` 的等价定义)与"条件 -> SQL 片段"生成。
//! 真源是结构化条件对象(D6),而非表达式字符串;标签匹配一律参数占位 + `substr` 前缀,
//! 禁止 LIKE 通配符(标签名可能含 `%`/`_`)。LIKE 只用于既有行为中的短关键词子串匹配。
//! 谓词模板(标签/关键词)抽到 [`filter_predicates`],与表达式编译器
//! [`crate::expr::compile`] 共用同一批实现 —— 两套输入,一套语义。
//! 日期范围筛选已整体取消(spec 2026-09-17 D2):条件对象里不再有 from/to。
//! Serialize 派生供自建视图把条件落库为 JSON(views.rs),查询语义不变。
use rusqlite::types::Value;
use serde::{Deserialize, Serialize};

/// 共用谓词真源(与表达式编译器共享,杜绝第二套标签/关键词语义)
#[path = "filter_predicates.rs"]
pub(crate) mod filter_predicates;
pub(crate) use filter_predicates::{keyword_predicate, tag_exists, tag_predicate};

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
/// (排序真源是 `notes.id`,与 created_at 同序;见 D1)
pub fn oldest_first(c: &FilterConditions) -> bool {
    c.sort.as_deref() == Some("oldest")
}

/// "挂了任意一个标签"的谓词(时间标签已是普通标签,D3:它也计数):
/// `any` = 存在该谓词,`none` = 不存在 —— 必须成对,否则两边都不命中。
fn any_tag() -> String {
    "EXISTS (SELECT 1 FROM tag_links l WHERE l.target_type = 'note' AND l.target_id = n.id)"
        .to_string()
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
        Some("any") => clauses.push(any_tag()),
        Some("none") => clauses.push(format!("NOT ({})", any_tag())),
        _ => {}
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
    // 附加表达式:空白视为未设置;非法时带原因与**字符位置**(0 起字符下标,
    // 与 expr::ExprError.pos / 前端 setSelectionRange 同一口径,切勿再 +1)
    if let Some(src) = c.expr.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if let Err(e) = crate::expr::validate(src) {
            return Err(format!("表达式:{}(第 {} 个字符)", e.message, e.pos));
        }
    }
    Ok(())
}
