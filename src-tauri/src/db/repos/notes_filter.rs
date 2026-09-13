//! 结构化筛选条件(前端 `filter-conditions.ts` 的等价定义)与"条件 -> SQL 片段"生成。
//! 真源是结构化条件对象(D6),而非表达式字符串;标签匹配一律参数占位 + `substr` 前缀,
//! 禁止 LIKE 通配符(标签名可能含 `%`/`_`)。LIKE 只用于既有行为中的短关键词子串匹配。
use rusqlite::types::Value;
use serde::Deserialize;

/// 单个标签条件:完整路径 + 是否含子级(前端默认含子级)
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct TagCond {
    pub path: String,
    pub include_children: bool,
}

/// 流查询条件对象;字段名与前端 `FilterConditions` 完全一致(JSON camelCase)
#[derive(Debug, Clone, Deserialize, Default)]
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

/// 排序片段:`oldest` 升序,其余(含缺失)降序
pub fn order_clause(c: &FilterConditions) -> &'static str {
    if c.sort.as_deref() == Some("oldest") {
        "n.id ASC"
    } else {
        "n.id DESC"
    }
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

/// 条件 -> `WHERE` 之后的 SQL 片段与参数(固定以 `1=1` 起手,子句用 ` AND ` 连接)
pub fn where_clause(c: &FilterConditions) -> (String, Vec<Value>) {
    let mut args: Vec<Value> = Vec::new();
    let mut clauses: Vec<String> = Vec::new();
    if let Some(k) = c.keyword.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        if k.chars().count() >= 3 {
            clauses.push("n.id IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?)".into());
            args.push(Value::Text(format!("\"{}\"*", k.replace('"', "\"\""))));
        } else {
            clauses.push(
                "(n.content LIKE ? OR EXISTS (SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id \
                 WHERE l.target_type = 'note' AND l.target_id = n.id AND t.path LIKE ?))"
                    .into(),
            );
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
        Some("any") => clauses.push(
            "EXISTS (SELECT 1 FROM tag_links l WHERE l.target_type = 'note' AND l.target_id = n.id)"
                .into(),
        ),
        Some("none") => clauses.push(
            "NOT EXISTS (SELECT 1 FROM tag_links l WHERE l.target_type = 'note' AND l.target_id = n.id)"
                .into(),
        ),
        _ => {}
    }
    if let Some(f) = c.from.as_deref() {
        clauses.push("n.created_at >= ?".into());
        args.push(Value::Text(f.to_string()));
    }
    // 结束日精确到当天:created_at 形如 `YYYY-MM-DD HH:MM:SS`,拼接 ISO 的 'T23:59:59' 后
    // 空格(0x20)小于 'T',当天全部时刻都满足 <=,字典序比较正确。
    if let Some(t) = c.to.as_deref() {
        clauses.push("n.created_at <= ? || 'T23:59:59'".into());
        args.push(Value::Text(t.to_string()));
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
        if !is_iso_date(f) {
            return Err("开始日期格式不正确(应为 YYYY-MM-DD)".into());
        }
    }
    if let Some(t) = c.to.as_deref() {
        if !is_iso_date(t) {
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

/// ISO 日期(`YYYY-MM-DD`)格式 + 基本日历合法性(闰年 2 月按公历判定)
fn is_iso_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    if !b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit()) {
        return false;
    }
    let num = |a: usize, z: usize| s[a..z].parse::<u32>().ok();
    match (num(0, 4), num(5, 7), num(8, 10)) {
        (Some(y), Some(m), Some(d)) => y >= 1 && (1..=12).contains(&m) && d >= 1 && d <= days_in_month(y, m),
        _ => false,
    }
}

/// 指定年月的天数
fn days_in_month(y: u32, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) => 29,
        2 => 28,
        _ => 0,
    }
}
