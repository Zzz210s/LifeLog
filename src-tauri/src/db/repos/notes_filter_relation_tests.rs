//! 关系条件的形状与向后兼容(设计 2026-10-06 §4 R4 / §10 R10b):
//! `filter_current` 字段由 `types`/`excludeTypes` 改名为 `relations`/`excludeRelations`;
//! 老库旧字段名(`types`/`excludeTypes` 与更早的 `roles`/`excludeRoles`)**非空**时必须回读,
//! 否则升级后一次级联改写就把存量关系条件静默抹成空。camelCase 与前端同构。
use super::*;

/// ① 旧 JSON(六字段)照常解析成空关系条件,且校验放行
#[test]
fn legacy_filter_json_without_relation_fields_parses_as_empty() {
    let raw = r#"{"keyword":null,"tags":[{"path":"工作","includeChildren":true}],
        "excludeTags":[],"tagPresence":null,"sort":"newest","expr":null}"#;
    let c: FilterConditions = serde_json::from_str(raw).unwrap();
    assert!(c.relations.is_empty(), "缺 relations -> 空");
    assert!(c.exclude_relations.is_empty(), "缺 excludeRelations -> 空");
    assert!(validate(&c).is_ok(), "老库条件必须仍能通过校验");
}

/// ①b 非空旧字段名 `types`/`excludeTypes`(本轮改名的来源字段)必须回读进 relations
#[test]
fn legacy_type_field_names_parse_into_relations() {
    let raw = r#"{"keyword":null,"tags":[],"excludeTags":[],
        "types":[{"path":"地点轴/国籍"}],"excludeTypes":[{"path":"所在"}],
        "tagPresence":null,"sort":"newest","expr":null}"#;
    let c: FilterConditions = serde_json::from_str(raw).unwrap();
    assert_eq!(
        c.relations,
        vec![RelationCond { path: "地点轴/国籍".into() }],
        "旧 types 非空时回读为 relations"
    );
    assert_eq!(
        c.exclude_relations,
        vec![RelationCond { path: "所在".into() }],
        "旧 excludeTypes 同理"
    );
}

/// ①c 更早的旧字段名 `roles`/`excludeRoles` 同样回读
#[test]
fn legacy_role_field_names_parse_into_relations() {
    let raw = r#"{"keyword":null,"tags":[],"excludeTags":[],
        "roles":[{"path":"地点轴/国籍"}],"excludeRoles":[{"path":"所在"}],
        "tagPresence":null,"sort":"newest","expr":null}"#;
    let c: FilterConditions = serde_json::from_str(raw).unwrap();
    assert_eq!(c.relations, vec![RelationCond { path: "地点轴/国籍".into() }], "旧 roles 回读");
    assert_eq!(c.exclude_relations, vec![RelationCond { path: "所在".into() }], "旧 excludeRoles 回读");
}

/// ② 关系条件按 camelCase 落库/读回,序列化只出新字段名
#[test]
fn relation_conditions_round_trip_in_camel_case() {
    let c = FilterConditions {
        tags: vec![TagCond { path: "工作".into(), include_children: true }],
        relations: vec![RelationCond { path: "地点轴/国籍".into() }],
        exclude_relations: vec![RelationCond { path: "所在".into() }],
        ..empty()
    };
    let json = serde_json::to_string(&c).unwrap();
    assert!(
        json.contains("\"relations\"") && json.contains("\"excludeRelations\""),
        "新字段名:{json}"
    );
    assert!(!json.contains("\"types\""), "不得再写旧字段名:{json}");
    let back: FilterConditions = serde_json::from_str(&json).unwrap();
    assert_eq!(back.relations, vec![RelationCond { path: "地点轴/国籍".into() }]);
    assert_eq!(back.exclude_relations, vec![RelationCond { path: "所在".into() }]);
    assert_eq!(back.tags.len(), 1, "既有标签条件不受影响");
}

/// ③ 关系路径走与标签同一套校验:结构非法拦下给中文原因
#[test]
fn invalid_relation_paths_are_rejected() {
    for bad in ["", "a//b", "工作 项目", "工作#项目"] {
        let c = FilterConditions { relations: vec![RelationCond { path: bad.into() }], ..empty() };
        let err = validate(&c).expect_err(&format!("{bad:?} 必须被拦下"));
        assert!(err.starts_with("标签路径不合法"), "{bad:?} 的中文原因:{err}");
    }
}

/// ④ 新旧字段同时出现(手工畸形 JSON):serde 视为重复字段直接拒绝 —— 级联路径据此
/// 跳过不动原文(见 filter_rewrite 的坏 JSON 分支),不会把条件静默抹成某一侧;
/// 前端口径是「新字段优先」。这条钉住 Rust 侧的明确行为,防止变成"取最后一个"。
#[test]
fn new_and_legacy_field_names_together_are_rejected_not_silently_merged() {
    let raw = r#"{"relations":[{"path":"新"}],"types":[{"path":"旧"}]}"#;
    assert!(
        serde_json::from_str::<FilterConditions>(raw).is_err(),
        "同时出现新旧字段名必须解析失败(不得静默合并且不得静默丢弃)"
    );
}
