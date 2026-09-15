//! 粗粒度时间标签与日期范围边界的查询验收(必修 4.1 / 4.2):
//! 只有年/月级或裸 `时间排序` 的标签视同"无时间标签"(排末尾、日期为空);
//! 日期上界截到日级长度比较,深于日级的路径不得被上界排除。
use crate::db::migrate;
use crate::db::repos::notes::notes_filter::*;
use crate::db::repos::notes::notes_query::query;
use crate::db::repos::notes::{create_on, create_plain};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

/// 必修4.1:只有年/月级或裸 `时间排序` 的标签没有日期,视同"无时间标签"(排末尾、日期为空)
#[test]
fn coarse_time_tags_are_treated_as_no_time_tag() {
    let mut c = db();
    create_on(&mut c, "有日期", "2026-09-15").unwrap();
    create_plain(&mut c, "只有月 #时间排序/2026/09").unwrap();
    create_plain(&mut c, "只有年 #时间排序/2025").unwrap();
    create_plain(&mut c, "裸根 #时间排序").unwrap();

    let all = query(&c, &empty(), 0).unwrap();

    assert_eq!(
        all.iter().map(|n| n.content.clone()).collect::<Vec<_>>(),
        vec!["有日期", "裸根", "只有年", "只有月"],
        "粗粒度时间标签不提供日期,按无时间标签规则压在有日期者之后(id 降序)"
    );
    for n in all.iter().skip(1) {
        assert_eq!(n.date, None);
        assert_eq!(n.date_tag_id, None);
    }
}

/// 必修4.2:日期上界截到日级长度比较 —— 更深路径(`时间排序/Y/M/D/子级`)不能被上界排除;
/// 粗粒度时间标签没有日期,与 from/to 两侧都不发生关系(与排序口径一致)
#[test]
fn date_range_bounds_are_symmetric_for_deeper_paths() {
    let mut c = db();
    let deep = create_plain(&mut c, "深路径 #时间排序/2026/09/15/子级").unwrap();
    let day = create_on(&mut c, "当天", "2026-09-15").unwrap();
    create_plain(&mut c, "只有月 #时间排序/2026/09").unwrap();

    let to = FilterConditions { to: Some("2026-09-15".into()), ..empty() };
    let hit = query(&c, &to, 0).unwrap();
    let ids: Vec<i64> = hit.iter().map(|n| n.id).collect();
    assert!(ids.contains(&deep.id), "上界不得排除深于日级的路径");
    assert!(ids.contains(&day.id));
    assert_eq!(hit.len(), 2, "粗粒度时间标签没有日期,不落入任何范围");
    assert_eq!(hit.iter().find(|n| n.id == deep.id).unwrap().date.as_deref(), Some("2026-09-15"));

    let both = FilterConditions {
        from: Some("2026-09-15".into()),
        to: Some("2026-09-15".into()),
        ..empty()
    };
    assert_eq!(query(&c, &both, 0).unwrap().len(), 2, "端点当天包含");
}
