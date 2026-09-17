//! 条件对象在真实库上的语义验收(含子级 / 仅本级 / 排除 / 有无标签 / 排序 / 计数)
//! 日期范围条件已整体取消(spec 2026-09-17 D2)。
use crate::db::migrate;
use crate::db::repos::notes::{create_on, create_plain, notes_filter::*, query};
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn tag(path: &str, include_children: bool) -> TagCond {
    TagCond { path: path.into(), include_children }
}

fn contents(notes: &[crate::db::repos::notes::Note]) -> Vec<String> {
    notes.iter().map(|n| n.content.clone()).collect()
}

fn at(c: &Connection, id: i64, ts: &str) {
    c.execute("UPDATE notes SET created_at=?1 WHERE id=?2", params![ts, id]).unwrap();
}

#[test]
fn include_children_hits_descendants_exact_does_not() {
    let mut c = db();
    create_plain(&mut c, "会议 #工作/项目A/会议").unwrap();
    create_plain(&mut c, "周报 #工作/项目A").unwrap();
    create_plain(&mut c, "杂记 #工作").unwrap();
    create_plain(&mut c, "无关").unwrap();
    let contains = FilterConditions { tags: vec![tag("工作", true)], ..empty() };
    assert_eq!(query(&c, &contains, 0).unwrap().len(), 3, "含子级应命中自身与全部子孙");
    let exact = FilterConditions { tags: vec![tag("工作", false)], ..empty() };
    assert_eq!(contents(&query(&c, &exact, 0).unwrap()), vec!["杂记"], "仅本级不得命中子孙");
    // 前缀边界:同名前缀的兄弟路径(工作2)不被 "工作" 命中
    create_plain(&mut c, "别家 #工作2").unwrap();
    assert_eq!(query(&c, &contains, 0).unwrap().len(), 3);
    assert_eq!(query(&c, &exact, 0).unwrap().len(), 1);
}

#[test]
fn exclude_tag_removes_matches() {
    let mut c = db();
    create_plain(&mut c, "甲 #电影 #临时").unwrap();
    create_plain(&mut c, "乙 #电影").unwrap();
    let cond = FilterConditions {
        tags: vec![tag("电影", false)],
        exclude_tags: vec![tag("临时", true)],
        ..empty()
    };
    assert_eq!(contents(&query(&c, &cond, 0).unwrap()), vec!["乙"]);
}

#[test]
fn tag_presence_any_and_none() {
    let mut c = db();
    create_plain(&mut c, "有标签 #甲").unwrap();
    create_plain(&mut c, "无标签正文").unwrap();
    let none = FilterConditions { tag_presence: Some("none".into()), ..empty() };
    assert_eq!(contents(&query(&c, &none, 0).unwrap()), vec!["无标签正文"]);
    let any = FilterConditions { tag_presence: Some("any".into()), ..empty() };
    assert_eq!(contents(&query(&c, &any, 0).unwrap()), vec!["有标签"]);
}

/// 想查某天/某段:点时间标签(含子级),而不是日期范围条件(D2 的替代路径)
#[test]
fn day_and_year_are_reached_through_time_tags() {
    let mut c = db();
    let a = create_on(&mut c, "八月", "2026-08-15").unwrap();
    let b = create_on(&mut c, "九月", "2026-09-13").unwrap();
    // 物理列 created_at 故意换成同一值:标签筛选完全不依赖它
    at(&c, a.id, "2030-01-01 10:00:00");
    at(&c, b.id, "2030-01-01 10:00:00");

    let day = FilterConditions { tags: vec![tag("时间排序/2026/09/13", false)], ..empty() };
    assert_eq!(contents(&query(&c, &day, 0).unwrap()), vec!["九月"]);
    let month = FilterConditions { tags: vec![tag("时间排序/2026/09", true)], ..empty() };
    assert_eq!(contents(&query(&c, &month, 0).unwrap()), vec!["九月"]);
    let year = FilterConditions { tags: vec![tag("时间排序/2026", true)], ..empty() };
    assert_eq!(contents(&query(&c, &year, 0).unwrap()), vec!["九月", "八月"], "默认最新在前");
    // 无时间标签的笔记只能靠“无标签”类条件找到,不落入任何时间标签筛选
    let plain = create_plain(&mut c, "无时间标签").unwrap();
    assert_eq!(query(&c, &FilterConditions { tag_presence: Some("none".into()), ..empty() }, 0)
        .unwrap().len(), 1);
    assert!(query(&c, &year, 0).unwrap().iter().all(|n| n.id != plain.id));
}

#[test]
fn combined_conditions_and_sort_flip() {
    let mut c = db();
    create_plain(&mut c, "一 #电影").unwrap();
    create_plain(&mut c, "二 #电影 #临时").unwrap();
    create_plain(&mut c, "三 #电影").unwrap();
    let cond = FilterConditions {
        keyword: Some("三".into()),
        tags: vec![tag("电影", true)],
        exclude_tags: vec![tag("临时", false)],
        tag_presence: Some("any".into()),
        sort: Some("oldest".into()),
        ..empty()
    };
    assert_eq!(contents(&query(&c, &cond, 0).unwrap()), vec!["三"]);
    let oldest = FilterConditions { sort: Some("oldest".into()), ..empty() };
    assert_eq!(contents(&query(&c, &oldest, 0).unwrap()), vec!["一", "二", "三"]);
}

#[test]
fn count_matching_tracks_query_hits() {
    let mut c = db();
    create_plain(&mut c, "a #电影").unwrap();
    create_plain(&mut c, "b #电影 #神作").unwrap();
    create_plain(&mut c, "c").unwrap();
    let cond = FilterConditions { tags: vec![tag("电影", true)], ..empty() };
    assert_eq!(super::count_matching(&c, &cond).unwrap(), 2);
    assert_eq!(query(&c, &cond, 0).unwrap().len(), 2);
    let none = FilterConditions { tag_presence: Some("none".into()), ..empty() };
    assert_eq!(super::count_matching(&c, &none).unwrap(), 1);
}
