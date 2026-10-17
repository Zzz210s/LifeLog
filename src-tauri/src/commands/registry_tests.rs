//! T3.4 IPC 契约用例:命令名清单与参数形状冻结(spec §8.1 / §8.3)。
//!
//! 全程**不依赖真实 runtime**:生产注册表整体绑定 `Wry`(多数命令签名固定为 `AppHandle`),
//! mock runtime 的 invoke 往返在本机 loader 层跑不起来(`0xc0000139`),故契约改在源码文本层钉:
//! ① 注册表源码含全部 v30 命令名(一个不少、不改名 —— 前端零改调用);
//! ② 新增恰为 `rename_line_name` / `create_line` / `remove_line` 三个;
//! ③ 命令层参数形状冻结(`set_tag_relation(fromTag,toTag,remark)` 三参、
//!    `remove_tag_relation(fromTag,toTag,nameId?)`、新三命令的参数名)。
//!
//! 命令的**语义**由 tags 仓库层用例覆盖(`relation_name_tests` / `line_name_tests`),
//! 本文件只守「名字与形状」这一层。
use std::collections::BTreeSet;

/// 注册表源码(在册清单的真源)
const REGISTRY_SRC: &str = include_str!("registry.rs");
/// 批量命令层源码(参数形状的真源)
const BATCH_SRC: &str = include_str!("batch.rs");

/// 导出命令层源码(export_points_of 的参数形状真源)
const EXCHANGE_SRC: &str = include_str!("exchange.rs");

/// 关系写命令层源码(参数形状的真源)
const TAGS_RELATION_SRC: &str = include_str!("tags_relation.rs");

/// v30 的 57 个命令名(与 v31 的差集必须恰为新增三个;改名会让前端调用失效)
const V30_COMMANDS: &[&str] = &[
    "add_tag_alias", "begin_input_drag", "carried_tag_paths", "complete_notes", "complete_tags",
    "condition_hit_counts", "delete_note", "delete_tag", "end_input_drag", "export_notes",
    "focus_input_bar", "get_autostart_status", "get_db_info", "get_input_hotkey", "get_setting",
    "graph_data", "graph_link_degrees", "group_skeleton", "hide_input_bar", "hide_main_window",
    "input_bar_visible", "list_tag_aliases", "list_tag_facts", "list_tag_relations", "list_tags",
    "merge_tags", "move_tag", "move_tag_beside", "note_links", "parse_note_source",
    "query_group_page", "query_grouped", "query_notes", "quit_app", "rebuild_search_index",
    "remove_tag_alias", "remove_tag_relation", "rename_tag", "save_input_note", "set_app_hotkey",
    "set_autostart", "set_input_height", "set_input_height_overlay", "set_input_hotkey",
    "set_input_locks", "set_input_scale", "set_input_size", "set_setting", "set_tag_relation",
    "show_input_bar", "tag_impact", "take_backup_warning", "take_pending_open_settings",
    "update_note", "validate_expr", "validate_time_tag_template", "webview_ack",
];

/// v31 新增(spec §8.3:其余命令名不变,差集恰为这三个)
const V31_NEW: &[&str] = &["rename_line_name", "create_line", "remove_line"];

/// v32 新增(批量编辑 spec 2026-10-17 §10.1:五个批量命令,其余名字不变)
const V32_NEW: &[&str] = &[
    "tag_points",
    "untag_points",
    "delete_points",
    "filter_point_ids",
    "export_points_of",
];

/// 从注册表源码抽出全部命令名(`crate::commands::<mod>::<name>,` 的末段)
fn registry_command_names() -> BTreeSet<String> {
    REGISTRY_SRC
        .lines()
        .filter_map(|l| l.trim().strip_prefix("crate::commands::"))
        .filter_map(|l| l.strip_suffix(','))
        .filter_map(|l| l.rsplit("::").next())
        .map(|s| s.to_string())
        .collect()
}

/// 用例 ①+②:v30 命令名一个不少,差集恰为新增三个(v31 共 60)
#[test]
fn registry_keeps_v30_names_and_adds_exactly_three() {
    let names = registry_command_names();
    for cmd in V30_COMMANDS {
        assert!(names.contains(*cmd), "v30 命令名 {cmd} 消失或被改名(前端零改调用被破坏)");
    }
    let v30: BTreeSet<&str> = V30_COMMANDS.iter().copied().collect();
    let added: BTreeSet<String> = names.iter().filter(|n| !v30.contains(n.as_str())).cloned().collect();
    let want: BTreeSet<String> =
        V31_NEW.iter().chain(V32_NEW.iter()).map(|s| s.to_string()).collect();
    assert_eq!(added, want, "新增命令名必须恰为 v31 + v32 两批");
    assert_eq!(names.len(), 65, "注册表命令总数 = 57 + 3 + 5");
}

/// 用例 ③:参数形状冻结(命令名不改的前提下,参数名/可选性也不得变)
#[test]
fn command_argument_shapes_are_frozen() {
    // 旧两命令:v30 三参(remark 必填)/ 两参 + v31 可选第 3 参 nameId
    for needle in [
        "from_tag: i64,",
        "to_tag: i64,",
        "remark: String,",
        "name_id: Option<i64>,",
    ] {
        assert!(TAGS_RELATION_SRC.contains(needle), "关系命令参数形状缺失:{needle}");
    }
    // 新三命令(spec §8.1):rename_line_name(nameId,newName)/ create_line(fromId,toId,nameId?)
    // / remove_line(lineId)
    for needle in ["name_id: i64,", "new_name: String", "from_id: i64,", "to_id: i64,", "line_id: i64"] {
        assert!(TAGS_RELATION_SRC.contains(needle), "新命令参数形状缺失:{needle}");
    }
    // 名字点必填参数不得退化成 Option(newName/lineId)
    assert!(!TAGS_RELATION_SRC.contains("new_name: Option"), "rename_line_name 的 newName 必须必填");
    assert!(!TAGS_RELATION_SRC.contains("line_id: Option"), "remove_line 的 lineId 必须必填");
    // v32 批量命令参数形状(spec §10.1):points / target / ids / conditions 都必填
    for needle in [
        "points: Vec<i64>,",
        "target: i64,",
        "ids: Vec<i64>",
        "conditions: FilterConditions,",
    ] {
        assert!(BATCH_SRC.contains(needle), "批量命令参数形状缺失:{needle}");
    }
    assert!(EXCHANGE_SRC.contains("ids: Vec<i64>)"), "export_points_of 必须收显式 ids");
    assert!(!BATCH_SRC.contains("points: Option"), "tag_points/untag_points 的 points 必须必填");
    assert!(!BATCH_SRC.contains("ids: Option"), "delete_points 的 ids 必须必填");
}
