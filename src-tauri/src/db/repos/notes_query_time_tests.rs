//! 排序与时间标签筛选(spec 2026-09-17 D1/D3):
//! 排序只按 `notes.id`(最新在前 = 降序 / 最早在前 = 升序),与日期无关;
//! 时间标签与普通标签完全同权 —— 点 `时间排序/2026` 含子级 = 整年。
use crate::db::migrate;
use crate::db::repos::notes::notes_filter::*;
use crate::db::repos::notes::notes_query::query;
use crate::db::repos::notes::{create, create_on, create_plain, Note};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn f(tags: &[&str]) -> FilterConditions {
    FilterConditions {
        tags: tags
            .iter()
            .map(|s| TagCond { path: s.to_string(), include_children: false })
            .collect(),
        ..empty()
    }
}

fn contents(notes: &[Note]) -> Vec<String> {
    notes.iter().map(|n| n.content.clone()).collect()
}

#[test]
fn newest_is_id_desc_and_oldest_is_id_asc() {
    let mut c = db();
    let a = create_plain(&mut c, "一").unwrap();
    let b = create_plain(&mut c, "二").unwrap();
    let d = create_plain(&mut c, "三").unwrap();

    let newest = query(&c, &empty(), 0).unwrap();
    let oldest = query(&c, &FilterConditions { sort: Some("oldest".into()), ..empty() }, 0).unwrap();

    assert_eq!(contents(&newest), vec!["三", "二", "一"], "默认最新在前");
    assert_eq!(contents(&oldest), vec!["一", "二", "三"], "oldest 最早在前");
    assert_eq!(newest.iter().map(|n| n.id).collect::<Vec<_>>(), vec![d.id, b.id, a.id]);
}

/// 排序与时间标签路径无关(只按 id):先建的笔记即使带更晚的日期,也排在后面
#[test]
fn sorting_ignores_time_tag_paths() {
    let mut c = db();
    create_on(&mut c, "先建但日期晚", "2026-12-31").unwrap();
    create_on(&mut c, "后建但日期早", "2020-01-01").unwrap();
    create_plain(&mut c, "后建无时间标签").unwrap();

    let newest = query(&c, &empty(), 0).unwrap();

    assert_eq!(
        contents(&newest),
        vec!["后建无时间标签", "后建但日期早", "先建但日期晚"],
        "无时间标签的笔记不再被压到末尾(D1:不按日期)"
    );
}

/// 查询结果带回全部标签(时间标签在内)与 created_at;Note 不再有 date/date_tag_id
#[test]
fn query_exposes_created_at_and_plain_tags() {
    let mut c = db();
    let n = create_on(&mut c, "带时间标签 #工作", "2026-03-04").unwrap();

    let got = query(&c, &empty(), 0).unwrap();

    assert_eq!(got[0].id, n.id);
    assert_eq!(got[0].tags, vec!["工作".to_string(), "时间排序/2026/03/04".to_string()]);
    assert!(!got[0].created_at.is_empty(), "created_at 物理列仍回传(展示与导出用)");
    // 搜索索引同样收时间标签(D3)
    let hits = query(&c, &FilterConditions { keyword: Some("2026".into()), ..empty() }, 0).unwrap();
    assert_eq!(hits.len(), 1, "时间标签参与关键词搜索");
}

/// 时间标签参与既有标签能力:点 `时间排序/2026` 含子级 = 整年(spec 5.2 的"看某天就点那天")
#[test]
fn time_subtree_tag_filter_covers_whole_year() {
    let mut c = db();
    create_on(&mut c, "今年一月", "2026-01-05").unwrap();
    create_on(&mut c, "今年九月", "2026-09-15").unwrap();
    create_on(&mut c, "去年", "2025-09-15").unwrap();

    let year = f(&["时间排序/2026"]);
    let mut year_children = year.clone();
    year_children.tags[0].include_children = true;

    assert!(query(&c, &year, 0).unwrap().is_empty(), "仅本级:没有笔记直接挂在年节点上");
    assert_eq!(contents(&query(&c, &year_children, 0).unwrap()), vec!["今年九月", "今年一月"]);
    let day = f(&["时间排序/2026/09/15"]);
    assert_eq!(contents(&query(&c, &day, 0).unwrap()), vec!["今年九月"]);
}

/// 一条笔记有多个时间标签(手打 + 自动)时两个都留在 tags 里:它们是普通标签,不再有收敛特例
#[test]
fn note_with_two_time_tags_keeps_both() {
    let mut c = db();
    let today = crate::timetag::today_local(&c).unwrap();
    let two = create(&mut c, "回填旧日期 #时间排序/2020/05/06").unwrap();

    assert_eq!(
        two.tags,
        vec!["时间排序/2020/05/06".to_string(), format!("时间排序/{}", today.replace('-', "/"))],
        "手打与自动标签并存"
    );
    let all = query(&c, &empty(), 0).unwrap();
    assert_eq!(all.iter().find(|n| n.id == two.id).unwrap().tags, two.tags);
    // 两个路径都是合法普通标签,可各自被筛选
    assert_eq!(contents(&query(&c, &f(&["时间排序/2020/05/06"]), 0).unwrap()), vec!["回填旧日期"]);
}

/// 无标签判定不看时间标签:时间标签也是标签(D3,与条件栏「无标签」口径一致)
#[test]
fn tag_presence_counts_time_tags() {
    let mut c = db();
    create_on(&mut c, "只有时间标签", "2026-09-15").unwrap();
    create_plain(&mut c, "真的没有标签").unwrap();

    let none = FilterConditions { tag_presence: Some("none".into()), ..empty() };
    let any = FilterConditions { tag_presence: Some("any".into()), ..empty() };

    assert_eq!(contents(&query(&c, &none, 0).unwrap()), vec!["真的没有标签"]);
    assert_eq!(contents(&query(&c, &any, 0).unwrap()), vec!["只有时间标签"]);
}
