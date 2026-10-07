//! 分组骨架与校验用例(T4):组名/计数、无值恒最后一组、方向、降级阈值、非法取值拦截。
//! 「多值只进一组」在看 `query_grouped` 的分组归属(`notes_group_page_tests.rs`)。
use crate::db::migrate;
use crate::db::repos::notes::notes_filter::{validate, GroupByCond};
use crate::db::repos::notes::notes_group::{skeleton, MAX_GROUPS, SLOW_MS};
use crate::db::repos::notes::{create_plain, FilterConditions};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn gb(path: &str, dir: &str) -> GroupByCond {
    GroupByCond { path: path.into(), dir: dir.into() }
}

/// 地点轴:中国大陆(2 条,含一条挂深一级)、日本(1)、美国(1)、轴本级(1)、无地点(1),
/// 另有一条同时挂 日本 与 美国(树序第一是 日本)。显式写树序让「树序」与「路径/id 序」分道扬镳。
fn axis_db() -> Connection {
    let mut c = db();
    create_plain(&mut c, "A1 #地点/中国大陆/四川省").unwrap();
    create_plain(&mut c, "A2 #地点/中国大陆").unwrap();
    create_plain(&mut c, "C1 #地点/美国").unwrap();
    create_plain(&mut c, "D1 #地点/日本 #地点/美国").unwrap();
    create_plain(&mut c, "E1 #地点").unwrap();
    create_plain(&mut c, "F1 无地点标签").unwrap();
    c.execute(
        "UPDATE tags SET sort_order = CASE path
             WHEN '地点/中国大陆' THEN 0 WHEN '地点/日本' THEN 1 WHEN '地点/美国' THEN 2
             ELSE sort_order END
         WHERE parent_id = (SELECT id FROM tags WHERE path = '地点')",
        [],
    )
    .unwrap();
    c
}

fn keys(groups: &[crate::db::repos::notes::notes_group::GroupSkeleton]) -> Vec<Option<String>> {
    groups.iter().map(|g| g.key.clone()).collect()
}

#[test]
fn skeleton_groups_by_first_level_child_with_labels_and_counts() {
    let c = axis_db();
    let r = skeleton(&c, &FilterConditions::default(), &gb("地点", "asc")).unwrap();
    assert_eq!(
        keys(&r.groups),
        vec![
            Some("地点".to_string()),
            Some("地点/中国大陆".to_string()),
            Some("地点/日本".to_string()),
            Some("地点/美国".to_string()),
            None,
        ],
        "组按树序排:轴本级 -> 中国大陆 -> 日本 -> 美国 -> 无值"
    );
    let counts: Vec<i64> = r.groups.iter().map(|g| g.count).collect();
    assert_eq!(counts, vec![1, 2, 1, 1, 1]);
    let labels: Vec<&str> = r.groups.iter().map(|g| g.label.as_str()).collect();
    assert_eq!(labels, vec!["地点", "中国大陆", "日本", "美国", "（无 地点）"]);
    let sum: i64 = counts.iter().sum();
    assert_eq!(sum, 6, "各组条数之和 = 命中的全部笔记(注释 §6.2:条数是组内总数)");
    assert!(!r.degraded && r.groups.len() <= MAX_GROUPS);
    assert!(r.elapsed_ms <= SLOW_MS as u64, "分片:小库骨架不该慢过阈值");
}

#[test]
fn skeleton_keeps_no_value_group_last_for_desc_too() {
    let c = axis_db();
    let r = skeleton(&c, &FilterConditions::default(), &gb("地点", "desc")).unwrap();
    assert_eq!(
        keys(&r.groups),
        vec![
            Some("地点/美国".to_string()),
            Some("地点/日本".to_string()),
            Some("地点/中国大陆".to_string()),
            Some("地点".to_string()),
            None,
        ],
        "dir 只反转有值组;无值组恒最后"
    );
    assert_eq!(r.groups.last().unwrap().count, 1);
}

#[test]
fn skeleton_respects_conditions_and_empty_library() {
    let c = axis_db();
    // 加一个关键词条件:只剩 A1/A2(F1 里没有「A」)
    let cond = FilterConditions {
        keyword: Some("A".into()),
        ..Default::default()
    };
    let r = skeleton(&c, &cond, &gb("地点", "asc")).unwrap();
    let counts: Vec<i64> = r.groups.iter().map(|g| g.count).collect();
    assert_eq!(counts, vec![2], "其它组被条件筛空后不出现在骨架里");
    // 空库:没有任何笔记就没有组(骨架是 `FROM notes ... GROUP BY`,空集不出组)
    let empty = db();
    let r = skeleton(&empty, &FilterConditions::default(), &gb("地点", "asc")).unwrap();
    assert!(r.groups.is_empty());
}

#[test]
fn skeleton_degrades_when_group_count_exceeds_limit() {
    let mut c = db();
    for i in 0..=MAX_GROUPS {
        create_plain(&mut c, &format!("n{i} #轴/t{i}")).unwrap();
    }
    let r = skeleton(&c, &FilterConditions::default(), &gb("轴", "asc")).unwrap();
    assert_eq!(r.groups.len(), MAX_GROUPS + 1);
    assert!(r.degraded, "组数超过 {MAX_GROUPS} 必须给降级标志(前端退化为平铺)");
    // 反向:正好等于上限不算降级
    let mut c2 = db();
    for i in 0..MAX_GROUPS {
        create_plain(&mut c2, &format!("n{i} #轴/t{i}")).unwrap();
    }
    let r2 = skeleton(&c2, &FilterConditions::default(), &gb("轴", "asc")).unwrap();
    assert_eq!(r2.groups.len(), MAX_GROUPS);
    assert!(!r2.degraded);
}

#[test]
fn validate_rejects_bad_group_by_and_accepts_defaults() {
    let case = |path: &str, dir: &str| FilterConditions {
        group_by: Some(GroupByCond { path: path.into(), dir: dir.into() }),
        ..Default::default()
    };
    assert!(validate(&case("地点", "desc")).is_ok());
    assert!(validate(&FilterConditions::default()).is_ok(), "不分组仍合法");
    assert!(validate(&case("地点", "sideways")).is_err(), "方向非法要拦");
    assert!(validate(&case("", "asc")).is_err(), "空轴路径要拦");
    assert!(validate(&case("地点/中国大陆", "asc")).is_ok(), "轴允许是子路径");
    // 缺字段回读:groupBy 缺失 / 只有 path 都落默认(asc)
    let parsed: FilterConditions = serde_json::from_str("{\"groupBy\":{\"path\":\"地点\"}}").unwrap();
    assert_eq!(parsed.group_by, Some(gb("地点", "asc")));
    let none: FilterConditions = serde_json::from_str("{}").unwrap();
    assert_eq!(none.group_by, None);
}

/// 真库只读验收读数(T4 判据 5/6):`cargo test --lib -- --ignored real_db_group_reading --nocapture`。
/// 默认读装机库路径(`%APPDATA%/com.lifelog.app/lifelog.db`),`LIFELOG_DB` 可覆盖;
/// 只读打开、只调应用自己的 `skeleton`(不自己拼 SQL),零写入。
#[test]
#[ignore]
fn real_db_group_reading() {
    let path = std::env::var("LIFELOG_DB").unwrap_or_else(|_| {
        format!("{}/com.lifelog.app/lifelog.db", std::env::var("APPDATA").unwrap_or_default())
    });
    let c = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    for axis in ["地点", "状态"] {
        let r = skeleton(&c, &FilterConditions::default(), &gb(axis, "asc")).unwrap();
        let none = r.groups.iter().find(|g| g.key.is_none()).map_or(0, |g| g.count);
        let top: Vec<String> = r
            .groups
            .iter()
            .take(6)
            .map(|g| format!("{}={}", g.label, g.count))
            .collect();
        let sum: i64 = r.groups.iter().map(|g| g.count).sum();
        println!(
            "轴 {axis}: 组数 {} | 无值组 {} | 各组之和 {} | 骨架 {}ms | 前几组 {top:?}",
            r.groups.len(),
            none,
            sum,
            r.elapsed_ms
        );
    }
}
