//! 条件对象 -> SQL 片段生成与校验的纯函数测试(测试先行 TDD;不依赖数据库)
use super::notes_filter::*;

fn tag(path: &str, include_children: bool) -> TagCond {
    TagCond { path: path.into(), include_children }
}

#[test]
fn empty_conditions_match_everything() {
    assert_eq!(where_clause(&empty()), ("1=1".to_string(), vec![]));
    assert!(!oldest_first(&empty()));
}

#[test]
fn tag_include_children_uses_prefix() {
    let c = FilterConditions { tags: vec![tag("工作", true)], ..empty() };
    let (sql, args) = where_clause(&c);
    assert!(sql.contains("t.path = ? OR substr(t.path, 1, length(?) + 1) = ? || '/'"));
    assert_eq!(args.len(), 3);
}

#[test]
fn tag_exact_match_has_no_prefix() {
    let c = FilterConditions { tags: vec![tag("工作", false)], ..empty() };
    let (sql, args) = where_clause(&c);
    assert!(sql.contains("t.path = ?"));
    assert!(!sql.contains("substr"));
    assert_eq!(args.len(), 1);
}

#[test]
fn two_tags_are_anded() {
    let c = FilterConditions { tags: vec![tag("a", false), tag("b", false)], ..empty() };
    let (sql, _) = where_clause(&c);
    assert_eq!(sql.matches("t.path = ?").count(), 2);
    assert!(sql.contains(" AND "));
}

#[test]
fn exclude_tag_uses_not_exists() {
    let c = FilterConditions { exclude_tags: vec![tag("临时", true)], ..empty() };
    let (sql, args) = where_clause(&c);
    assert!(sql.contains("NOT EXISTS"));
    assert_eq!(args.len(), 3);
}

/// 有无标签:只算**时间子树之外**的标签(时间标签是系统元数据,不是用户的归类)。
/// any/none 必须成对,否则只带时间标签的笔记两个条件都不命中。
#[test]
fn tag_presence_ignores_time_subtree_tags() {
    let c = FilterConditions { tag_presence: Some("none".into()), ..empty() };
    let (sql, _) = where_clause(&c);
    assert!(sql.contains("NOT (EXISTS (SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id"));
    assert!(sql.contains("t.path = '时间排序'"), "裸根也算时间子树:{sql}");
    assert!(sql.contains("substr(t.path, 1, length('时间排序') + 1) = '时间排序/'"));

    let c = FilterConditions { tag_presence: Some("any".into()), ..empty() };
    let (sql, _) = where_clause(&c);
    assert!(sql.starts_with("1=1 AND EXISTS (SELECT 1 FROM tag_links l JOIN tags t"));
    assert!(!sql.contains("NOT (EXISTS"), "any 不得带排除:{sql}");
}

/// 日期范围(单边/双边):谓词改为时间标签路径比较,不再出现 created_at
#[test]
fn date_range_compares_time_tag_path() {
    let c = FilterConditions { from: Some("2026-08-01".into()), ..empty() };
    let (sql, args) = where_clause(&c);
    assert!(sql.contains("t.path >= ?"));
    assert!(!sql.contains("created_at"));
    assert_eq!(texts(&args), vec!["时间排序/2026/08/01"]);

    let c = FilterConditions { to: Some("2026-09-13".into()), ..empty() };
    let (sql, args) = where_clause(&c);
    assert!(
        sql.contains("substr(t.path, 1, length(?)) <= ?"),
        "上界截到日级长度比较(深于日级的路径不被排除):{sql}"
    );
    assert_eq!(texts(&args), vec!["时间排序/2026/09/13", "时间排序/2026/09/13"]);
    // 只认至少到日级的时间标签:粗粒度(年/月/裸根)没有日期,不入任何范围
    assert!(sql.contains("length(t.path) >= 15"));

    // 日期非法(未经 validate)恒假,不放宽语义
    let c = FilterConditions { from: Some("2026-13-01".into()), ..empty() };
    assert!(where_clause(&c).0.contains("0=1"));
}

/// 短关键词(<=2 字符)退化 LIKE 时标签侧同样排除时间子树:搜 `11` 不得命中整段时期
#[test]
fn short_keyword_like_branch_excludes_time_tags() {
    let c = FilterConditions { keyword: Some("11".into()), ..empty() };
    let (sql, args) = where_clause(&c);
    assert!(sql.contains("t.path LIKE ?"));
    assert!(sql.contains("NOT ((t.path = '时间排序'"), "时间标签不参与关键词:{sql}");
    assert_eq!(texts(&args), vec!["%11%", "%11%"]);
}

/// 参数向量的文本视图(断言生成的路径边界)
fn texts(args: &[rusqlite::types::Value]) -> Vec<String> {
    args.iter()
        .map(|v| match v {
            rusqlite::types::Value::Text(t) => t.clone(),
            other => panic!("非文本参数:{other:?}"),
        })
        .collect()
}

#[test]
fn sort_oldest_flips_order() {
    let c = FilterConditions { sort: Some("oldest".into()), ..empty() };
    assert!(oldest_first(&c));
    assert!(!oldest_first(&FilterConditions { sort: Some("newest".into()), ..empty() }));
}

#[test]
fn validate_rejects_bad_input() {
    assert!(validate(&FilterConditions { from: Some("2026-09-13".into()), to: Some("2026-08-01".into()), ..empty() }).is_err());
    assert!(validate(&FilterConditions { tags: vec![tag("", false)], ..empty() }).is_err());
    assert!(validate(&FilterConditions { tags: vec![tag("a//b", false)], ..empty() }).is_err());
    assert!(validate(&FilterConditions { keyword: Some("x".repeat(201)), ..empty() }).is_err());
    assert!(validate(&FilterConditions { sort: Some("sideways".into()), ..empty() }).is_err());
    assert!(validate(&FilterConditions {
        tags: (0..21).map(|i| tag(&format!("t{i}"), false)).collect(), ..empty()
    }).is_err());
    assert!(validate(&(FilterConditions { tags: vec![tag("工作", true)], ..empty() })).is_ok());
}

/// 校验还须拒绝:日期格式非法、标签有无取值非法、排除标签越限
#[test]
fn validate_rejects_more_bad_input() {
    assert!(validate(&FilterConditions { from: Some("2026-13-01".into()), ..empty() }).is_err());
    assert!(validate(&FilterConditions { to: Some("26-01-01".into()), ..empty() }).is_err());
    assert!(validate(&FilterConditions { tag_presence: Some("some".into()), ..empty() }).is_err());
    assert!(validate(&FilterConditions {
        exclude_tags: (0..21).map(|i| tag(&format!("t{i}"), false)).collect(), ..empty()
    }).is_err());
    assert!(validate(&FilterConditions { tags: vec![tag("工作/项目A", true)], ..empty() }).is_ok());
}

/// 关键词/标签条件都是**参数占位**:片段里不得出现 LIKE 通配符,值只进参数向量
#[test]
fn tag_values_go_through_placeholders_only() {
    let c = FilterConditions { tags: vec![tag("a%b_c", true)], exclude_tags: vec![tag("x/y", true)], ..empty() };
    let (sql, args) = where_clause(&c);
    assert!(!sql.contains('%'));
    assert!(!sql.contains("a%b_c"));
    assert_eq!(args.len(), 6);
    let texts: Vec<String> = args
        .iter()
        .map(|v| match v {
            rusqlite::types::Value::Text(t) => t.clone(),
            other => panic!("非文本参数:{other:?}"),
        })
        .collect();
    assert_eq!(texts, vec!["a%b_c", "a%b_c", "a%b_c", "x/y", "x/y", "x/y"]);
}
