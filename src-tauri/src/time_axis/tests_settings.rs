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
