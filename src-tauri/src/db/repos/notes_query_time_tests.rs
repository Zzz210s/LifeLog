//! 时间标签驱动的流查询行为(spec 2026-09-15 第 4.3 节):
//! 排序(时间标签路径 + id 兜底、无标签排末尾)、date/date_tag_id 读数、时间子树筛选。
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
fn newest_orders_by_time_path_desc_then_id_desc() {
    let mut c = db();
    create_on(&mut c, "旧", "2025-12-31").unwrap();
    create_on(&mut c, "八月", "2026-08-31").unwrap();
    // 同一天两条:靠 id 兜底(新的在前)
    create_on(&mut c, "同日首条", "2026-09-15").unwrap();
    create_on(&mut c, "同日次条", "2026-09-15").unwrap();

    let newest = query(&c, &empty(), 0).unwrap();

    assert_eq!(contents(&newest), vec!["同日次条", "同日首条", "八月", "旧"]);
}

#[test]
fn oldest_orders_by_time_path_asc_then_id_asc() {
    let mut c = db();
    create_on(&mut c, "旧", "2025-12-31").unwrap();
    create_on(&mut c, "八月", "2026-08-31").unwrap();
    create_on(&mut c, "同日首条", "2026-09-15").unwrap();
    create_on(&mut c, "同日次条", "2026-09-15").unwrap();
    let cond = FilterConditions { sort: Some("oldest".into()), ..empty() };

    let oldest = query(&c, &cond, 0).unwrap();

    assert_eq!(contents(&oldest), vec!["旧", "八月", "同日首条", "同日次条"]);
}

/// 排序边界:同年跨月、同月同日都按零填充路径的字典序正确比较;无时间标签者排末尾
#[test]
fn ordering_is_stable_across_months_and_tagless_notes_go_last() {
    let mut c = db();
    create_plain(&mut c, "无时间标签一").unwrap();
    create_on(&mut c, "九月", "2026-09-01").unwrap();
    create_on(&mut c, "十月", "2026-10-01").unwrap();
    create_on(&mut c, "去年十二月", "2025-12-01").unwrap();
    create_plain(&mut c, "无时间标签二").unwrap();

    let newest = query(&c, &empty(), 0).unwrap();

    assert_eq!(
        contents(&newest),
        vec!["十月", "九月", "去年十二月", "无时间标签二", "无时间标签一"],
        "有日期者按路径降序在前,无时间标签者按 id 降序排在末尾"
    );
}

/// 查询结果带回 date / date_tag_id(界面显示日期与改期寻址),created_at 仍在结构里但不再用
#[test]
fn query_exposes_date_and_date_tag_id() {
    let mut c = db();
    let n = create_on(&mut c, "带日期 #工作", "2026-03-04").unwrap();

    let got = query(&c, &empty(), 0).unwrap();

    assert_eq!(got[0].date.as_deref(), Some("2026-03-04"));
    let tag_id: i64 = c
        .query_row("SELECT id FROM tags WHERE path='时间排序/2026/03/04'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(got[0].date_tag_id, Some(tag_id));
    assert_eq!(got[0].tags, vec!["工作".to_string(), "时间排序/2026/03/04".to_string()]);
    assert_eq!(got[0].id, n.id);
    assert!(!got[0].created_at.is_empty(), "created_at 物理列仍回传(前端不再使用)");

    let plain = create_plain(&mut c, "没有时间标签").unwrap();
    let all = query(&c, &empty(), 0).unwrap();
    let tagless = all.iter().find(|x| x.id == plain.id).unwrap();
    assert_eq!(tagless.date, None);
    assert_eq!(tagless.date_tag_id, None);
}

/// 时间标签参与既有标签能力:点 `时间排序/2026` 含子级 = 整年(spec 4.1)
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

/// 必修1(路径最小 = 最早):同一笔记有多个时间标签时,date 与 date_tag_id 必须取自**同一行**
/// (旧实现的 MAX(path)/MAX(id) 是两个独立聚合,会各取一行);排序也必须落在该日期上。
/// 三处口径(query / read_full / 导出)完全一致。
#[test]
fn note_with_two_time_tags_takes_same_earliest_row() {
    let mut c = db();
    let today = crate::timetag::today_local(&c).unwrap();
    assert_ne!(today, "2020-05-06", "测试前提:当天不是 2020-05-06");
    // 正文手打旧日期 = 用户回填旧笔记:系统当天标签与手打标签并存
    let two = create(&mut c, "回填旧日期 #时间排序/2020/05/06").unwrap();
    let mid = create_on(&mut c, "中间日期", "2021-01-01").unwrap();
    let old_id: i64 = c
        .query_row("SELECT id FROM tags WHERE path='时间排序/2020/05/06'", [], |r| r.get(0))
        .unwrap();
    let today_id: i64 = c
        .query_row(
            "SELECT id FROM tags WHERE path='时间排序/' || replace(?1, '-', '/')",
            [&today],
            |r| r.get(0),
        )
        .unwrap();

    let all = query(&c, &empty(), 0).unwrap();
    let got = all.iter().find(|n| n.id == two.id).unwrap();
    assert_eq!(got.date.as_deref(), Some("2020-05-06"), "取路径最小(最早)的一条");
    assert_eq!(got.date_tag_id, Some(old_id), "date_tag_id 必须指向 date 所在那一行");
    assert_ne!(got.date_tag_id, Some(today_id));
    // 排序落在该日期上:比 2021-01-01 更早,故默认(最新在前)排在它后面
    assert_eq!(
        all.iter().map(|n| n.content.clone()).collect::<Vec<_>>(),
        vec!["中间日期", "回填旧日期"],
        "若排序误用当天路径,两条顺序会翻转"
    );
    // 口径一致:read_full 与导出同样取最早
    let full = crate::db::repos::notes::notes_read::read_full(&c, two.id).unwrap().unwrap();
    assert_eq!((full.date, full.date_tag_id), (got.date.clone(), got.date_tag_id));
    let export = crate::exchange::notes_export::rows(&c).unwrap();
    assert_eq!(export[1].date, "2020-05-06");
    assert_eq!(export[0].date, "2021-01-01");
    assert_eq!(export[1].content, "回填旧日期");
    let _ = mid;
}

