//! 自建视图仓库层测试(测试先行 TDD):CRUD 往返、重名、标题与数量边界、
//! 排序整批重写、坏条件拒写、内置视图条件、命中计数口径。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes::FilterConditions;
use crate::db::repos::notes::notes_filter::empty;
use crate::db::repos::notes::notes_query::count_matching;
use rusqlite::Connection;

/// 迁移到最新的内存库
fn test_conn() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

/// 条件是否等价于空条件(全部;排序不构成收窄,但此处连同检查)
fn is_empty_conditions(c: &FilterConditions) -> bool {
    c.keyword.is_none()
        && c.tags.is_empty()
        && c.exclude_tags.is_empty()
        && c.from.is_none()
        && c.to.is_none()
        && c.tag_presence.is_none()
        && c.sort.is_none()
}

#[test]
fn create_list_update_delete_roundtrip() {
    let conn = test_conn();
    let id = create(&conn, "待办里的工作", &FilterConditions { keyword: Some("会议".into()), ..empty() }).unwrap();
    let all = list(&conn).unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].title, "待办里的工作");
    assert_eq!(all[0].conditions.keyword.as_deref(), Some("会议"));
    update(&conn, id, "改名后", &empty()).unwrap();
    assert_eq!(list(&conn).unwrap()[0].title, "改名后");
    remove(&conn, id).unwrap();
    assert!(list(&conn).unwrap().is_empty());
}

#[test]
fn duplicate_title_rejected() {
    let conn = test_conn();
    create(&conn, "同名", &empty()).unwrap();
    assert!(create(&conn, "同名", &empty()).is_err());
}

#[test]
fn title_bounds_and_view_limit() {
    let conn = test_conn();
    assert!(create(&conn, "", &empty()).is_err());
    assert!(create(&conn, &"长".repeat(41), &empty()).is_err());
    for i in 0..50 { create(&conn, &format!("视图{i}"), &empty()).unwrap(); }
    assert!(create(&conn, "第51个", &empty()).is_err());
}

#[test]
fn reorder_rewrites_sort_order() {
    let mut conn = test_conn();
    let a = create(&conn, "A", &empty()).unwrap();
    let b = create(&conn, "B", &empty()).unwrap();
    reorder(&mut conn, &[b, a]).unwrap();
    let all = list(&conn).unwrap();
    assert_eq!(all.iter().map(|v| v.title.as_str()).collect::<Vec<_>>(), vec!["B", "A"]);
}

#[test]
fn invalid_conditions_rejected_on_write() {
    let conn = test_conn();
    let bad = FilterConditions { from: Some("2026-09-13".into()), to: Some("2026-08-01".into()), ..empty() };
    assert!(create(&conn, "坏条件", &bad).is_err());
}

#[test]
fn builtin_conditions() {
    let todo = conditions_of_builtin("todo");
    assert_eq!(todo.tags.len(), 1);
    assert_eq!(todo.tags[0].path, "todo");
    assert!(!todo.tags[0].include_children);
    assert_eq!(todo.exclude_tags[0].path, "done");
    assert_eq!(conditions_of_builtin("untagged").tag_presence.as_deref(), Some("none"));
    assert!(is_empty_conditions(&conditions_of_builtin("all")));
    assert!(is_empty_conditions(&conditions_of_builtin("nonsense")));
}

// ---- 以下为本任务验收点补充测试(口径与边界,不改变 brief 设计) ----

/// 改名撞其他视图重名必须拒绝,且不改动原数据
#[test]
fn update_to_duplicate_title_rejected() {
    let conn = test_conn();
    create(&conn, "A", &empty()).unwrap();
    let b = create(&conn, "B", &empty()).unwrap();
    assert!(update(&conn, b, "A", &empty()).is_err());
    assert_eq!(list(&conn).unwrap().len(), 2, "失败的改名不得丢数据");
}

/// 排序清单必须是全部自建视图的一次重排:缺项/未知项/重复项都拒绝
#[test]
fn reorder_rejects_partial_unknown_or_duplicated_ids() {
    let mut conn = test_conn();
    let a = create(&conn, "A", &empty()).unwrap();
    let b = create(&conn, "B", &empty()).unwrap();
    assert!(reorder(&mut conn, &[a]).is_err());
    assert!(reorder(&mut conn, &[a, 999]).is_err());
    assert!(reorder(&mut conn, &[a, a]).is_err());
    assert!(reorder(&mut conn, &[]).is_err());
    // 整批校验失败后排序原样
    assert_eq!(
        list(&conn).unwrap().iter().map(|v| v.title.as_str()).collect::<Vec<_>>(),
        vec!["A", "B"]
    );
    let _ = b;
}

/// 命中计数:内置三视图在前(键 all/todo/untagged),自建视图在后(键 view:<id>),
/// 数值口径与 notes_query::count_matching 一致
#[test]
fn hit_counts_cover_builtins_and_saved_views() {
    let mut conn = test_conn();
    for text in ["#todo 买牛奶", "#done 收尾", "没有标签的笔记", "#todo #done 两边都占"] {
        crate::db::repos::notes::create_plain(&mut conn, text).unwrap();
    }
    let id = create(
        &conn,
        "有标签的",
        &FilterConditions { tag_presence: Some("any".into()), ..empty() },
    )
    .unwrap();
    let hits = hit_counts(&conn).unwrap();
    assert_eq!(hits[0], ("all".to_string(), 4));
    assert_eq!(hits[1], ("todo".to_string(), 1), "仅 #todo 且未 #done 的笔记");
    assert_eq!(hits[2], ("untagged".to_string(), 1));
    assert_eq!(hits[3], (format!("view:{id}"), 3));
    // 口径一致性:与 count_matching 直接对读
    let stored = list(&conn).unwrap();
    assert_eq!(hits[3].1, count_matching(&conn, &stored[0].conditions).unwrap());
    assert_eq!(hits[1].1, count_matching(&conn, &conditions_of_builtin("todo")).unwrap());
}
/// 内置「无自定义标签」= 时间子树之外没有任何标签(时间标签是系统元数据)。
/// 回填/新建后所有笔记都带时间标签,旧的 tag_links 空判永远命中 0 条。
#[test]
fn untagged_counts_notes_with_only_time_tags() {
    let mut conn = test_conn();
    crate::db::repos::notes::create(&mut conn, "只有时间标签").unwrap();
    let untagged = conditions_of_builtin("untagged");
    let any = conditions_of_builtin("any-none-placeholder");
    assert_eq!(count_matching(&conn, &untagged).unwrap(), 1);
    assert!(is_empty_conditions(&any), "未知 key 回退全部");
    assert_eq!(count_matching(&conn, &FilterConditions { tag_presence: Some("any".into()), ..empty() }).unwrap(), 0);
    // 加一个普通标签后:它不再算"无自定义标签",但进入"有标签"
    crate::db::repos::notes::create(&mut conn, "带用户标签 #甲").unwrap();
    assert_eq!(count_matching(&conn, &untagged).unwrap(), 1);
    assert_eq!(count_matching(&conn, &FilterConditions { tag_presence: Some("any".into()), ..empty() }).unwrap(), 1);
    assert_eq!(count_matching(&conn, &untagged).unwrap() + count_matching(&conn, &FilterConditions { tag_presence: Some("any".into()), ..empty() }).unwrap(), 2, "any/none 必须互补");
}

