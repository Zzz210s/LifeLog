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

/// 有无标签:时间标签也是普通标签(D3),一律计入;any/none 必须成对。
#[test]
fn tag_presence_counts_all_tags() {
    let c = FilterConditions { tag_presence: Some("none".into()), ..empty() };
    let (sql, _) = where_clause(&c);
    assert!(sql.contains("NOT (EXISTS (SELECT 1 FROM tag_links l"), "{sql}");
    assert!(!sql.contains("时间排序"), "不再有时间子树例外:{sql}");

    let c = FilterConditions { tag_presence: Some("any".into()), ..empty() };
    let (sql, _) = where_clause(&c);
    assert!(sql.starts_with("1=1 AND EXISTS (SELECT 1 FROM tag_links l"), "{sql}");
    assert!(!sql.contains("NOT (EXISTS"), "any 不得带排除:{sql}");
}

/// 短关键词(<=2 字符)退化 LIKE 时正文与标签两侧一视同仁(时间标签已是普通标签,D3)
#[test]
fn short_keyword_like_branch_has_no_time_tag_exception() {
    let c = FilterConditions { keyword: Some("11".into()), ..empty() };
    let (sql, args) = where_clause(&c);
    assert!(sql.contains("n.content LIKE ?"), "{sql}");
    assert!(sql.contains("AND t.path LIKE ?"), "{sql}");
    assert!(!sql.contains("时间排序"), "时间标签不再被排除:{sql}");
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

/// 011 之前的存量条件 JSON 带 from/to:反序列化必须静默忽略这两个键(升级兼容)
#[test]
fn legacy_from_to_keys_are_ignored() {
    let c: FilterConditions = serde_json::from_str(
        r#"{"keyword":"甲乙丙","tags":[],"excludeTags":[],"from":"2026-08-01","to":"2026-08-31","tagPresence":null,"sort":"oldest","expr":null}"#,
    )
    .unwrap();
    assert_eq!(c.keyword.as_deref(), Some("甲乙丙"));
    assert!(c.sort.as_deref() == Some("oldest"));
    assert!(validate(&c).is_ok(), "旧键不得导致校验失败");
    let (sql, args) = where_clause(&c);
    assert!(!sql.contains("created_at"), "{sql}");
    assert_eq!(args.len(), 1, "只剩关键词一个参数");
}

#[test]
fn sort_oldest_flips_order() {
    let c = FilterConditions { sort: Some("oldest".into()), ..empty() };
    assert!(oldest_first(&c));
    assert!(!oldest_first(&FilterConditions { sort: Some("newest".into()), ..empty() }));
}

#[test]
fn validate_rejects_bad_input() {
    assert!(validate(&FilterConditions { tags: vec![tag("", false)], ..empty() }).is_err());
    assert!(validate(&FilterConditions { tags: vec![tag("a//b", false)], ..empty() }).is_err());
    assert!(validate(&FilterConditions { keyword: Some("x".repeat(201)), ..empty() }).is_err());
    assert!(validate(&FilterConditions { sort: Some("sideways".into()), ..empty() }).is_err());
    assert!(validate(&FilterConditions {
        tags: (0..21).map(|i| tag(&format!("t{i}"), false)).collect(), ..empty()
    }).is_err());
    assert!(validate(&(FilterConditions { tags: vec![tag("工作", true)], ..empty() })).is_ok());
}

/// 校验还须拒绝:标签有无取值非法、排除标签越限
#[test]
fn validate_rejects_more_bad_input() {
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
