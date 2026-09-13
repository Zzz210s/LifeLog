//! 条件对象 -> SQL 片段生成与校验的纯函数测试(测试先行 TDD;不依赖数据库)
use super::notes_filter::*;

fn tag(path: &str, include_children: bool) -> TagCond {
    TagCond { path: path.into(), include_children }
}

#[test]
fn empty_conditions_match_everything() {
    assert_eq!(where_clause(&empty()), ("1=1".to_string(), vec![]));
    assert_eq!(order_clause(&empty()), "n.id DESC");
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

#[test]
fn no_tags_uses_not_exists_on_tag_links() {
    let c = FilterConditions { tag_presence: Some("none".into()), ..empty() };
    let (sql, _) = where_clause(&c);
    assert!(sql.contains("NOT EXISTS (SELECT 1 FROM tag_links l WHERE l.target_type = 'note' AND l.target_id = n.id)"));

    let c = FilterConditions { tag_presence: Some("any".into()), ..empty() };
    let (sql, _) = where_clause(&c);
    assert!(sql.contains("EXISTS (SELECT 1 FROM tag_links l WHERE l.target_type = 'note' AND l.target_id = n.id)"));
}

#[test]
fn date_range_supports_one_sided() {
    let c = FilterConditions { from: Some("2026-08-01".into()), ..empty() };
    let (sql, args) = where_clause(&c);
    assert!(sql.contains("n.created_at >= ?"));
    assert_eq!(args.len(), 1);

    let c = FilterConditions { to: Some("2026-09-13".into()), ..empty() };
    let (sql, args) = where_clause(&c);
    assert!(sql.contains("n.created_at <= ?") || sql.contains("n.created_at < ?"));
    assert_eq!(args.len(), 1);
}

#[test]
fn sort_oldest_flips_order() {
    let c = FilterConditions { sort: Some("oldest".into()), ..empty() };
    assert_eq!(order_clause(&c), "n.id ASC");
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
