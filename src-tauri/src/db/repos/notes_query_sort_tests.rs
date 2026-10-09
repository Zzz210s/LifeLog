//! 排序数据模型与标签轴排序用例(2026-10-06 T1,自 notes_query_tests 拆出守 200 行):
//! 旧单值 `sort` 的合成回退、多键 ORDER BY、无值沉底、同键 `n.id` 兜底、排序校验。
use crate::db::migrate;
use crate::db::repos::notes::notes_filter::{validate, SortCond};
use crate::db::repos::notes::notes_sort::effective_sorts;
use crate::db::repos::notes::{create_on, create_plain, query as query_all, FilterConditions, Note};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    crate::db::repos::tags::test_support::install_legacy_name_views(&c);
    c
}

fn cond(sorts: Vec<SortCond>, legacy: Option<&str>) -> FilterConditions {
    FilterConditions {
        sort: legacy.map(String::from),
        sorts,
        ..Default::default()
    }
}

fn time(dir: &str, enabled: bool) -> SortCond {
    SortCond::Time { dir: dir.into(), enabled }
}

fn tag(path: &str, dir: &str, enabled: bool) -> SortCond {
    SortCond::Tag { path: path.into(), dir: dir.into(), enabled }
}

fn contents(notes: &[Note]) -> Vec<String> {
    notes.iter().map(|n| n.content.clone()).collect()
}

/// 5 条笔记:轴下 A/B 两个子标签;「AB」同时挂两个(取树序第一个)。
/// 创建序把 B 放在前面,sort_order 会与 id 同向 —— 测试里反手把兄弟序调换成 A 在前,
/// 让「树序」与「id 序」分道扬镳,才能证明排序键取的是 sort_order 而不是 id。
fn axis_db() -> Connection {
    let mut c = db();
    create_plain(&mut c, "B1 #轴/B").unwrap();
    create_plain(&mut c, "A1 #轴/A").unwrap();
    create_plain(&mut c, "NONE").unwrap();
    create_plain(&mut c, "AB #轴/A #轴/B").unwrap();
    create_plain(&mut c, "B2 #轴/B").unwrap();
    // ensure_path 新建兄弟一律 sort_order=0(默认值),这里按「用户拖过顺序」写入显式树序
    c.execute(
        "UPDATE entities SET sort_order = CASE path WHEN '轴/A' THEN 0 ELSE 1 END
         WHERE path IS NOT NULL
           AND parent_id = (SELECT id FROM entities WHERE path = '轴')",
        [],
    )
    .unwrap();
    c
}

#[test]
fn effective_sorts_synthesizes_from_legacy_only_when_empty() {
    assert_eq!(effective_sorts(&cond(vec![], Some("oldest"))), vec![time("asc", true)]);
    assert_eq!(effective_sorts(&cond(vec![], None)), vec![time("desc", true)]);
    // sorts 非空(含全停用)以 sorts 为准,旧 sort 不再参与
    let all_off = vec![tag("轴", "asc", false)];
    assert_eq!(effective_sorts(&cond(all_off.clone(), Some("oldest"))), all_off);
}

#[test]
fn legacy_oldest_matches_explicit_asc_time_sort() {
    let mut c = db();
    for (i, t) in ["甲", "乙", "丙", "丁"].iter().enumerate() {
        create_on(&mut c, t, &format!("2026-01-0{}", i + 1)).unwrap();
    }
    let legacy = query(&c, &cond(vec![], Some("oldest")), 0).unwrap();
    let explicit = query(&c, &cond(vec![time("asc", true)], None), 0).unwrap();
    assert_eq!(contents(&legacy), contents(&explicit));
    assert_eq!(contents(&legacy), vec!["甲", "乙", "丙", "丁"]);
    // 空数组 = 默认:与 latest 单值同序
    let newest = query(&c, &cond(vec![], None), 0).unwrap();
    assert_eq!(contents(&newest), vec!["丁", "丙", "乙", "甲"]);
}

#[test]
fn all_disabled_sorts_fall_back_to_default_newest() {
    let mut c = db();
    for t in ["甲", "乙", "丙"] {
        create_plain(&mut c, t).unwrap();
    }
    let got = query(&c, &cond(vec![tag("轴", "asc", false)], None), 0).unwrap();
    assert_eq!(contents(&got), vec!["丙", "乙", "甲"], "全停用 -> 默认最新在前");
}

#[test]
fn tag_axis_sorts_by_tree_order_and_nulls_sink_regardless_of_dir() {
    let c = axis_db();
    let asc = contents(&query(&c, &cond(vec![tag("轴", "asc", true)], None), 0).unwrap());
    assert_eq!(asc, vec!["A1", "AB", "B1", "B2", "NONE"], "按 sort_order 树序,非 id/path 序");
    let desc = contents(&query(&c, &cond(vec![tag("轴", "desc", true)], None), 0).unwrap());
    assert_eq!(desc, vec!["B2", "B1", "AB", "A1", "NONE"], "选项倒序:组内 id 同向,组序反转");
    assert_eq!(desc.last().unwrap(), "NONE", "无该标签的笔记恒排最后(与方向无关)");
    assert_eq!(desc[desc.len() - 2], "A1", "有值项全部在无值项之前");
}

#[test]
fn multi_key_sorts_apply_in_priority_order() {
    let c = axis_db();
    // 主键:轴 asc;次键:时间 desc(组内 id 降序)—— 次键确实生效
    let got = contents(
        &query(&c, &cond(vec![tag("轴", "asc", true), time("desc", true)], None), 0).unwrap(),
    );
    assert_eq!(got, vec!["AB", "A1", "B2", "B1", "NONE"]);
}

#[test]
fn validate_rejects_over_limit_and_bad_sort_values() {
    let six = vec![time("desc", true); 6];
    assert!(validate(&cond(six, None)).unwrap_err().contains("排序条件最多 5 条"));
    assert!(validate(&cond(vec![time("sideways", true)], None)).is_err(), "方向取值非法");
    assert!(validate(&cond(vec![tag("a//b", "asc", true)], None)).is_err(), "标签路径非法");
    assert!(validate(&cond(vec![tag("轴", "asc", true), time("desc", false)], None)).is_ok());
}


/// 统一元数据后 `query` 的域是全实体(spec §4.1:清空筛选即显示标签);
/// 本文件的老用例只关心迁移前的「全部笔记」,故把默认筛选并入条件(见 test_support)。
fn query(
    c: &Connection,
    cond: &crate::db::repos::notes::notes_filter::FilterConditions,
    offset: i64,
) -> Result<Vec<crate::db::repos::notes::Note>, String> {
    query_all(c, &crate::db::repos::tags::test_support::with_note_domain(cond.clone()), offset)
}
