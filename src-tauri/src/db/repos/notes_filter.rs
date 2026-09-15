//! 结构化筛选条件(前端 `filter-conditions.ts` 的等价定义)与"条件 -> SQL 片段"生成。
//! 真源是结构化条件对象(D6),而非表达式字符串;标签匹配一律参数占位 + `substr` 前缀,
//! 禁止 LIKE 通配符(标签名可能含 `%`/`_`)。LIKE 只用于既有行为中的短关键词子串匹配。
//! Serialize 派生供自建视图把条件落库为 JSON(views.rs),查询语义不变。
use rusqlite::types::Value;
use serde::{Deserialize, Serialize};

/// 单个标签条件:完整路径 + 是否含子级(前端默认含子级)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct TagCond {
    pub path: String,
    pub include_children: bool,
}

/// 流查询条件对象;字段名与前端 `FilterConditions` 完全一致(JSON camelCase)。
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

/// 单个标签的匹配子句:含子级时"自身或 `path + "/"` 开头",否则精确等于。
/// 值只进参数向量;前缀用 `substr(path, 1, length(?) + 1) = ? || '/'`(无通配符)。
fn tag_match(c: &TagCond, args: &mut Vec<Value>) -> String {
    args.push(Value::Text(c.path.clone()));
    if c.include_children {
        args.push(Value::Text(c.path.clone()));
        args.push(Value::Text(c.path.clone()));
        "t.path = ? OR substr(t.path, 1, length(?) + 1) = ? || '/'".to_string()
    } else {
        "t.path = ?".to_string()
    }
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
        if k.chars().count() >= 3 {
            clauses.push("n.id IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?)".into());
            args.push(Value::Text(format!("\"{}\"*", k.replace('"', "\"\""))));
        } else {
            // 短关键词退化 LIKE:标签侧同样排除时间子树(时间由日期筛选负责,不靠关键词)
            clauses.push(format!(
                "(n.content LIKE ? OR EXISTS (SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id \
                 WHERE l.target_type = 'note' AND l.target_id = n.id AND NOT ({}) AND t.path LIKE ?))",
                crate::timetag::sql_in_time_subtree("t")
            ));
            let pat = format!("%{k}%");
            args.push(Value::Text(pat.clone()));
            args.push(Value::Text(pat));
        }
    }
    for t in &c.tags {
        let m = tag_match(t, &mut args);
        clauses.push(format!(
            "EXISTS (SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id \
             WHERE l.target_type = 'note' AND l.target_id = n.id AND ({m}))"
        ));
    }
    for t in &c.exclude_tags {
        let m = tag_match(t, &mut args);
        clauses.push(format!(
            "NOT EXISTS (SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id \
             WHERE l.target_type = 'note' AND l.target_id = n.id AND ({m}))"
        ));
    }
    match c.tag_presence.as_deref() {
        Some("any") => clauses.push(has_custom_tag()),
        Some("none") => clauses.push(format!("NOT ({})", has_custom_tag())),
        _ => {}
    }
    if let Some(f) = c.from.as_deref() {
        clauses.push(time_range(">=", f, &mut args));
    }
    if let Some(t) = c.to.as_deref() {
        clauses.push(time_range("<=", t, &mut args));
    }
    let mut out = String::from("1=1");
    for cl in clauses {
        out.push_str(" AND");
        out.push(' ');
        out.push_str(&cl);
    }
    (out, args)
}

/// 日期范围条件(D2:不再触碰 created_at):比较该笔记的时间标签路径与
/// `时间排序/<Y>/<M>/<D>` 边界(年/月/日零填充,字典序即时间序;端点当天包含在内)。
/// 下界整串比较、上界截到日级长度再比:更深的路径(`时间排序/Y/M/D/子级`)与当天同界,
/// 不得因尾随 `/子级` 被上界排除(与下界对称)。`length(?)` 与比较各占一个位置参数
/// (匿名占位符按出现次序消耗),故上界压两个参数。粗粒度时间标签(年/月级)没有日期,
/// 与 [`crate::timetag::sql_has_time_day`] 一致地不落入任何范围。
/// 日期非法(未经 [`validate`])时给出恒假条件:宁可查不到,也不放宽语义。
fn time_range(op: &str, date: &str, args: &mut Vec<Value>) -> String {
    let Some(bound) = crate::timetag::path_for_date(date) else {
        return "0=1".to_string();
    };
    let lhs = if op == ">=" {
        args.push(Value::Text(bound));
        "t.path".to_string()
    } else {
        args.push(Value::Text(bound.clone()));
        args.push(Value::Text(bound));
        "substr(t.path, 1, length(?))".to_string()
    };
    format!(
        "EXISTS (SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id \
         WHERE l.target_type = 'note' AND l.target_id = n.id AND {} AND {lhs} {op} ?)",
        crate::timetag::sql_has_time_day("t")
    )
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
    Ok(())
}
