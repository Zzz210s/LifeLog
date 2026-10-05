//! Task 2 角色条件的形状与向后兼容(spec 2026-10-05 §5 条件栏口径):
//! 老库的 `filter_current` 没有 `roles`/`excludeRoles` 字段,必须按「无角色条件」解析
//! (否则升级后老库一开就整条筛选解析失败)。camelCase 与前端同构。
use super::*;

/// ① 旧 JSON(六个字段)照常解析成空角色条件,且校验放行
#[test]
fn legacy_filter_json_without_role_fields_parses_as_no_role_conditions() {
    let raw = r#"{"keyword":null,"tags":[{"path":"工作","includeChildren":true}],
        "excludeTags":[],"tagPresence":null,"sort":"newest","expr":null}"#;
    let c: FilterConditions = serde_json::from_str(raw).unwrap();
    assert!(c.roles.is_empty(), "缺 roles -> 空");
    assert!(c.exclude_roles.is_empty(), "缺 excludeRoles -> 空");
    assert!(validate(&c).is_ok(), "老库条件必须仍能通过校验");
}

/// ② 角色条件按 camelCase 落库/读回,旧字段不受影响
#[test]
fn role_conditions_round_trip_in_camel_case() {
    let c = FilterConditions {
        tags: vec![TagCond { path: "工作".into(), include_children: true }],
        roles: vec![RoleCond { path: "地点轴/国籍".into() }],
        exclude_roles: vec![RoleCond { path: "所在".into() }],
        ..empty()
    };
    let json = serde_json::to_string(&c).unwrap();
    assert!(json.contains("\"roles\"") && json.contains("\"excludeRoles\""), "字段名:{json}");
    let back: FilterConditions = serde_json::from_str(&json).unwrap();
    assert_eq!(back.roles, vec![RoleCond { path: "地点轴/国籍".into() }]);
    assert_eq!(back.exclude_roles, vec![RoleCond { path: "所在".into() }]);
    assert_eq!(back.tags.len(), 1, "既有标签条件不受影响");
}

/// ③ 角色路径走与标签同一套校验:结构非法拦下给中文原因
#[test]
fn invalid_role_paths_are_rejected() {
    for bad in ["", "a//b", "工作 项目", "工作#项目"] {
        let c = FilterConditions { roles: vec![RoleCond { path: bad.into() }], ..empty() };
        let err = validate(&c).expect_err(&format!("{bad:?} 必须被拦下"));
        assert!(err.starts_with("标签路径不合法"), "{bad:?} 的中文原因:{err}");
    }
}
