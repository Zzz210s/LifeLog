//! 条件对象在真实库上的语义验收(含子级 / 仅本级 / 排除 / 有无标签 / 日期 / 排序 / 计数)
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

/// 日期范围改按**时间标签路径**比较(spec 4.3,D2:不再触碰 created_at):
/// from -> `时间排序/Y/M/D` 下界,to -> 上界路径等值比较(端点当天包含)。
#[test]
fn date_range_compares_time_tag_paths() {
    let mut c = db();
    let a = create_on(&mut c, "八月", "2026-08-15").unwrap();
    let b = create_on(&mut c, "九月", "2026-09-13").unwrap();
    // 物理列 created_at 故意设成同一值:筛选必须完全不依赖它
    at(&c, a.id, "2030-01-01 10:00:00");
    at(&c, b.id, "2030-01-01 10:00:00");
    let from = FilterConditions { from: Some("2026-09-01".into()), ..empty() };
    assert_eq!(contents(&query(&c, &from, 0).unwrap()), vec!["九月"]);
    let to = FilterConditions { to: Some("2026-08-31".into()), ..empty() };
    assert_eq!(contents(&query(&c, &to, 0).unwrap()), vec!["八月"]);
    let both = FilterConditions {
        from: Some("2026-08-01".into()),
        to: Some("2026-08-31".into()),
        ..empty()
    };
    assert_eq!(contents(&query(&c, &both, 0).unwrap()), vec!["八月"]);
    // 端点当天必须包含(to 不截断到 00:00)
    let same_day = FilterConditions { to: Some("2026-08-15".into()), ..empty() };
    assert_eq!(contents(&query(&c, &same_day, 0).unwrap()), vec!["八月"]);
    let from_same_day = FilterConditions { from: Some("2026-08-15".into()), ..empty() };
    assert_eq!(contents(&query(&c, &from_same_day, 0).unwrap()), vec!["九月", "八月"], "默认最新在前");
    // 无时间标签的笔记不落入任何日期范围(它没有日期可比)
    create_plain(&mut c, "无时间标签").unwrap();
    assert_eq!(query(&c, &from_same_day, 0).unwrap().len(), 2);
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
