//! 设置键路径改写与 E1 集合口径单测(自 tests.rs 拆出以守 200 行上限)。
use super::s1_tree;
use super::tests_support::{apply, fixture, note_with_tags, tags_of};
use crate::db::repos::settings;

/// 三个 settings 键的路径改写与「不含时间路径的条目逐字节不变」
#[test]
fn s1_rewrites_settings_paths() {
    let mut c = fixture();
    settings::set(
        &c,
        settings::FILTER_CURRENT_KEY,
        &serde_json::json!({
            "keyword": "十月",
            "tags": [{"path": "时间/日期/2025/08", "includeChildren": true}],
            "excludeTags": [{"path": "时间/日期/2026", "includeChildren": false}],
            "tagPresence": null,
            "sort": "newest",
            "expr": "#时间/日期/2026/09 AND NOT #工作2"
        })
        .to_string(),
    )
    .unwrap();
    settings::set(&c, "ui.pinned.tags", r#"["时间/日期/2025","工作"]"#).unwrap();
    settings::set(
        &c,
        "ui.mru.tags",
        r#"[{"id":"时间/日期/2026","count":2},{"id":"工作","count":1}]"#,
    )
    .unwrap();

    apply(&mut c);

    let fc = settings::get(&c, settings::FILTER_CURRENT_KEY)
        .unwrap()
        .unwrap();
    assert!(!fc.contains("时间/日期"), "{fc}");
    assert!(
        fc.contains("时间/2025/08") && fc.contains("时间/2026") && fc.contains("时间/2026/09"),
        "{fc}"
    );
    assert!(
        fc.contains("工作2") && fc.contains("十月") && fc.contains("newest"),
        "其余字段原样保留:{fc}"
    );
    assert_eq!(
        settings::get(&c, "ui.pinned.tags").unwrap().unwrap(),
        r#"["时间/2025","工作"]"#
    );
    assert_eq!(
        settings::get(&c, "ui.mru.tags").unwrap().unwrap(),
        r#"[{"id":"时间/2026","count":2},{"id":"工作","count":1}]"#,
        "MRU 只改 id,count 原样"
    );
}

/// E6:坏 JSON 不动、不失败(改写是尽力而为,不因一个键坏掉就拒绝收敛)
#[test]
fn s1_leaves_broken_settings_json_alone() {
    let mut c = fixture();
    settings::set(&c, "ui.pinned.tags", "[坏 JSON").unwrap();
    apply(&mut c);
    assert_eq!(
        settings::get(&c, "ui.pinned.tags").unwrap().unwrap(),
        "[坏 JSON"
    );
}

/// P7:被删容器的 `graph_positions` 陈旧键**只报不清理**(键原样留在 settings 里)
#[test]
fn s1_reports_stale_graph_positions_without_cleaning() {
    let mut c = fixture();
    let (alive, doomed) = (
        super::tests_support::id_at(&c, "时间"),
        super::tests_support::id_at(&c, "时间/日期/2026"),
    );
    let positions = format!(r#"{{"{alive}":{{"x":1,"y":2}},"{doomed}":{{"x":3,"y":4}}}}"#);
    settings::set(&c, "graph_positions", &positions).unwrap();

    let plan = s1_tree::plan(&c).unwrap();
    assert_eq!(plan.stale_positions, 0, "两个键都指向现存节点");
    let report = s1_tree::apply(&mut c, &plan).unwrap();
    assert!(
        report
            .iter()
            .any(|l| l == "graph_positions 陈旧键 0 -> 1(本轮删容器新增 1,只报不清理)"),
        "{report:?}"
    );
    assert_eq!(
        settings::get(&c, "graph_positions").unwrap().unwrap(),
        positions,
        "陈旧键不被清理(逐字节原样)"
    );
}

/// 例外只认「本轮被删的容器」:本来就不存在的陈旧键仍判失败,且整个事务回滚
#[test]
fn s1_still_fails_on_pre_existing_stale_position_key() {
    let mut c = fixture();
    let doomed = super::tests_support::id_at(&c, "时间/日期/2026");
    settings::set(
        &c,
        "graph_positions",
        &format!(r#"{{"{doomed}":{{"x":1,"y":2}},"999999":{{"x":3,"y":4}}}}"#),
    )
    .unwrap();
    let plan = s1_tree::plan(&c).unwrap();
    assert_eq!(plan.stale_positions, 1, "999999 本来就不存在");
    let err = s1_tree::apply(&mut c, &plan).unwrap_err();
    assert_eq!(err.code, 3, "{}", err.message);
    assert!(err.message.contains("settings 快照键"), "{}", err.message);
    assert_eq!(
        s1_tree::readings(&c).unwrap(),
        plan.pre,
        "自对账失败即整体回滚"
    );
    assert!(
        c.query_row(
            "SELECT COUNT(*) FROM points WHERE path LIKE '时间/日期%'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap()
            > 0,
        "回滚后 v2 子树原样在库"
    );
}

/// E1 按**集合**比:映射后可能与其它标签换位(真库 91 篇的实际形状)。
/// 夹具:`时间/出版年份/2016` 原排在 `时间/日期/2026/03/28` 前,映射后 `时间/2026/...` 在前。
#[test]
fn s1_self_check_compares_tag_sets_not_order() {
    let mut c = fixture();
    note_with_tags(
        &mut c,
        &["时间/日期/2026/03/28", "时间/出版年份/2016"],
        "换位笔记",
    );
    let plan = s1_tree::plan(&c).unwrap();
    let report = s1_tree::apply(&mut c, &plan).unwrap();
    assert!(
        report
            .iter()
            .any(|l| l.starts_with("E1 笔记标签集合逐一对应")),
        "{report:?}"
    );
    let id: i64 = c
        .query_row(
            "SELECT id FROM points WHERE meta = '换位笔记'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        tags_of(&c, id),
        vec![
            "时间/2026/03/28".to_string(),
            "时间/出版年份/2016".to_string()
        ],
        "两个标签都在,按路径升序返回"
    );
}
