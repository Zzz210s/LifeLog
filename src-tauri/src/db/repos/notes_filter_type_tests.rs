//! Task 2 类型条件的形状与向后兼容(spec 2026-10-05 §5 条件栏口径):
//! 老库的 `filter_current` 没有 `types`/`excludeTypes` 字段,必须按「无类型条件」解析
//! (否则升级后老库一开就整条筛选解析失败)。camelCase 与前端同构。
use super::*;

/// ① 旧 JSON(六个字段)照常解析成空类型条件,且校验放行
#[test]
fn legacy_filter_json_without_type_fields_parses_as_no_type_conditions() {
    let raw = r#"{"keyword":null,"tags":[{"path":"工作","includeChildren":true}],
        "excludeTags":[],"tagPresence":null,"sort":"newest","expr":null}"#;
    let c: FilterConditions = serde_json::from_str(raw).unwrap();
    assert!(c.types.is_empty(), "缺 types -> 空");
    assert!(c.exclude_types.is_empty(), "缺 excludeTypes -> 空");
    assert!(validate(&c).is_ok(), "老库条件必须仍能通过校验");
}

/// ①b 老库的**非空**旧字段名(`roles`/`excludeRoles`)必须回读进 types —— 均为空数组的向量
/// 测不出漏读:漏读时级联改写会把整条类型条件静默抹掉(serde 默认忽略未知字段)。
#[test]
fn legacy_role_field_names_parse_into_types() {
    let raw = r#"{"keyword":null,"tags":[],"excludeTags":[],
        "roles":[{"path":"地点轴/国籍"}],"excludeRoles":[{"path":"所在"}],
        "tagPresence":null,"sort":"newest","expr":null}"#;
    let c: FilterConditions = serde_json::from_str(raw).unwrap();
    assert_eq!(c.types, vec![TypeCond { path: "地点轴/国籍".into() }], "旧 roles 非空时回读为 types");
    assert_eq!(c.exclude_types, vec![TypeCond { path: "所在".into() }], "旧 excludeRoles 同理");
}

/// ② 类型条件按 camelCase 落库/读回,旧字段不受影响
#[test]
fn type_conditions_round_trip_in_camel_case() {
    let c = FilterConditions {
        tags: vec![TagCond { path: "工作".into(), include_children: true }],
        types: vec![TypeCond { path: "地点轴/国籍".into() }],
        exclude_types: vec![TypeCond { path: "所在".into() }],
        ..empty()
    };
    let json = serde_json::to_string(&c).unwrap();
    assert!(json.contains("\"types\"") && json.contains("\"excludeTypes\""), "字段名:{json}");
    let back: FilterConditions = serde_json::from_str(&json).unwrap();
    assert_eq!(back.types, vec![TypeCond { path: "地点轴/国籍".into() }]);
    assert_eq!(back.exclude_types, vec![TypeCond { path: "所在".into() }]);
    assert_eq!(back.tags.len(), 1, "既有标签条件不受影响");
}

/// ③ 类型路径走与标签同一套校验:结构非法拦下给中文原因
#[test]
fn invalid_type_paths_are_rejected() {
    for bad in ["", "a//b", "工作 项目", "工作#项目"] {
        let c = FilterConditions { types: vec![TypeCond { path: bad.into() }], ..empty() };
        let err = validate(&c).expect_err(&format!("{bad:?} 必须被拦下"));
        assert!(err.starts_with("标签路径不合法"), "{bad:?} 的中文原因:{err}");
    }
}
