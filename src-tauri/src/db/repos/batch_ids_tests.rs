//! 「全选筛选结果」取数用例(spec 2026-10-17 §3.4):与 `query` 同集、标签条件收窄、空条件全量。
use super::filter_ids;
use crate::db::migrate;
use crate::db::repos::notes::notes_filter::FilterConditions;
use crate::db::repos::notes::notes_filter_groups::{FilterGroup, GroupItem};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrate::run(&c).unwrap();
    c
}

/// 三条笔记(1/2/3)+ 标签 10;1 与 2 挂 10,3 不挂。
fn seed(c: &Connection) {
    c.execute_batch(
        "INSERT INTO points(id, meta, created_at, path, depth) VALUES
           (1, '笔记甲', '2026-01-01', NULL, NULL),
           (2, '笔记乙', '2026-01-01', NULL, NULL),
           (3, '笔记丙', '2026-01-01', NULL, NULL),
           (10, '目标', '2026-01-01', '目标', 1);
         INSERT INTO lines(id, from_id, to_id, name_id) VALUES
           (100, 1, 10, NULL),
           (101, 2, 10, NULL);",
    )
    .unwrap();
}

fn sorted(mut v: Vec<i64>) -> Vec<i64> {
    v.sort_unstable();
    v
}

/// 空条件:全量(含树内标签),且与 `query`（另一条 SQL 路径）同集。
#[test]
fn empty_conditions_match_query_ids() {
    let c = db();
    seed(&c);
    let conds = FilterConditions::default();
    let ids = sorted(filter_ids(&c, &conds).unwrap());
    let from_query = sorted(
        crate::db::repos::notes::query(&c, &conds, 0).unwrap().into_iter().map(|n| n.id).collect(),
    );
    assert_eq!(ids, from_query);
    assert_eq!(ids, vec![1, 2, 3, 10], "空条件应含全部非纯名字点(含标签)");
}

/// 标签条件(仅本级):只命中直接挂该标签的条目。
#[test]
fn tag_condition_narrows_to_linked_notes() {
    let c = db();
    seed(&c);
    let conds = FilterConditions {
        groups: vec![FilterGroup {
            op: "and".into(),
            items: vec![GroupItem::Tag { path: "目标".into(), include_children: false }],
        }],
        ..Default::default()
    };
    assert_eq!(sorted(filter_ids(&c, &conds).unwrap()), vec![1, 2]);
}

/// 行序与信息流一致:默认时间降序时 id 由大到小(沉尾键此时无差异)。
#[test]
fn ids_are_ordered_newest_first() {
    let c = db();
    seed(&c);
    // 只取树外笔记(排除标签 10),看时间序
    let conds = FilterConditions {
        groups: vec![FilterGroup {
            op: "and".into(),
            items: vec![GroupItem::TreeMembership { value: "out".into() }],
        }],
        ..Default::default()
    };
    assert_eq!(filter_ids(&c, &conds).unwrap(), vec![3, 2, 1]);
}
