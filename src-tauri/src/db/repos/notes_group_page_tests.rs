//! 分组分页用例(T4):每组首屏 K=20、组内排序只作用组内、组内 offset 续页不串组、
//! 多值只进一组、骨架/续页与筛选条件同源。
use crate::db::migrate;
use crate::db::repos::notes::notes_filter::GroupByCond;
use crate::db::repos::notes::notes_group::{skeleton, GroupPage, PER_GROUP};
use crate::db::repos::notes::notes_group_query::{query_group_page, query_grouped};
use crate::db::repos::notes::notes_sort::SortCond;
use crate::db::repos::notes::{create_plain, FilterConditions, Note};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn gb(path: &str) -> GroupByCond {
    GroupByCond { path: path.into(), dir: "asc".into() }
}

fn time(dir: &str) -> FilterConditions {
    FilterConditions {
        sorts: vec![SortCond::Time { dir: dir.into(), enabled: true }],
        ..Default::default()
    }
}

fn keys(pages: &[GroupPage]) -> Vec<Option<String>> {
    pages.iter().map(|p| p.key.clone()).collect()
}

fn contents(notes: &[Note]) -> Vec<String> {
    notes.iter().map(|n| n.content.clone()).collect()
}

fn ids(notes: &[Note]) -> Vec<i64> {
    notes.iter().map(|n| n.id).collect()
}

/// 轴/A(3 条)、轴/B(2 条):显式树序保证组间顺序确定(同时验 `g.key` 同序键兜底)
fn two_group_db() -> Connection {
    let mut c = db();
    create_plain(&mut c, "A1 #轴/A").unwrap();
    create_plain(&mut c, "A2 #轴/A").unwrap();
    create_plain(&mut c, "A3 #轴/A").unwrap();
    create_plain(&mut c, "B1 #轴/B").unwrap();
    create_plain(&mut c, "B2 #轴/B").unwrap();
    c
}

#[test]
fn grouped_first_screen_orders_groups_and_limits_each_to_k() {
    let mut c = db();
    for i in 0..25 {
        create_plain(&mut c, &format!("A{i:02} #轴/A")).unwrap();
    }
    create_plain(&mut c, "B1 #轴/B").unwrap();
    create_plain(&mut c, "无值").unwrap();
    let pages = query_grouped(&c, &FilterConditions::default(), &gb("轴")).unwrap();
    assert_eq!(keys(&pages), vec![Some("轴/A".into()), Some("轴/B".into()), None]);
    assert_eq!(pages[0].notes.len(), PER_GROUP as usize, "首屏固定 K=20(不是 PAGE_SIZE)");
    assert_eq!(pages[1].notes.len(), 1);
    assert_eq!(pages[2].notes.len(), 1);
    assert!(
        ids(&pages[0].notes).windows(2).all(|w| w[0] > w[1]),
        "组内默认顺序 = 时间倒序,且是**组内**的"
    );
}

#[test]
fn sorts_apply_inside_group_only() {
    let c = two_group_db();
    let asc = query_grouped(&c, &time("asc"), &gb("轴")).unwrap();
    assert_eq!(keys(&asc), vec![Some("轴/A".into()), Some("轴/B".into())], "组间顺序不受 sorts 影响");
    assert_eq!(contents(&asc[0].notes), vec!["A1", "A2", "A3"]);
    let desc = query_grouped(&c, &time("desc"), &gb("轴")).unwrap();
    assert_eq!(keys(&desc), vec![Some("轴/A".into()), Some("轴/B".into())]);
    assert_eq!(contents(&desc[0].notes), vec!["A3", "A2", "A1"], "同一组内方向翻转");
    assert_eq!(contents(&desc[1].notes), vec!["B2", "B1"]);
}

#[test]
fn multi_valued_note_enters_exactly_one_group_by_tree_order() {
    let mut c = db();
    create_plain(&mut c, "D1 #轴/乙 #轴/甲").unwrap();
    create_plain(&mut c, "E1 #轴/甲").unwrap();
    // 树序:甲=0、乙=1(创建序相反,保证取的是树序而不是 id/路径序)
    c.execute(
        "UPDATE entities SET sort_order = CASE path WHEN '轴/甲' THEN 0 ELSE 1 END
         WHERE kind = 'tag'
           AND parent_id = (SELECT id FROM entities WHERE kind = 'tag' AND path = '轴')",
        [],
    )
    .unwrap();
    let pages = query_grouped(&c, &FilterConditions::default(), &gb("轴")).unwrap();
    assert_eq!(keys(&pages), vec![Some("轴/甲".into())], "乙 组无笔记,不出现");
    assert_eq!(contents(&pages[0].notes), vec!["E1", "D1"]);
    // 计数口径:骨架里各组之和 = 笔记总数(多值不重复计数)
    let r = skeleton(&c, &FilterConditions::default(), &gb("轴")).unwrap();
    let sum: i64 = r.groups.iter().map(|g| g.count).sum();
    assert_eq!(sum, 2);
}

#[test]
fn group_page_offset_is_scoped_inside_group_and_does_not_disturb_other_groups() {
    let mut c = db();
    for i in 0..55 {
        create_plain(&mut c, &format!("A{i:02} #轴/A")).unwrap();
    }
    for i in 0..3 {
        create_plain(&mut c, &format!("B{i} #轴/B")).unwrap();
    }
    let cond = FilterConditions::default();
    let b_first = query_group_page(&c, &cond, &gb("轴"), Some("轴/B"), 0).unwrap();
    assert_eq!(contents(&b_first), vec!["B2", "B1", "B0"]);
    let a1 = query_group_page(&c, &cond, &gb("轴"), Some("轴/A"), 0).unwrap();
    let a2 = query_group_page(&c, &cond, &gb("轴"), Some("轴/A"), 50).unwrap();
    assert_eq!(a1.len(), 50);
    assert_eq!(a2.len(), 5);
    assert!(a1.iter().all(|n| n.tags.iter().any(|t| t == "轴/A")));
    assert!(a2.iter().all(|n| n.tags.iter().any(|t| t == "轴/A")));
    let mut all: Vec<i64> = ids(&a1);
    all.extend(ids(&a2));
    all.sort_unstable();
    all.dedup();
    assert_eq!(all.len(), 55, "组内续页不重不漏(offset 只数本组)");
    assert!(ids(&a1).iter().min() > ids(&a2).iter().max(), "第二页紧接第一页");
    let b_again = query_group_page(&c, &cond, &gb("轴"), Some("轴/B"), 0).unwrap();
    assert_eq!(ids(&b_first), ids(&b_again), "翻 A 组的页不影响 B 组的 offset");
}

#[test]
fn grouped_queries_share_conditions_with_flat_query() {
    let c = two_group_db();
    let cond = FilterConditions {
        keyword: Some("A2".into()),
        ..Default::default()
    };
    let pages = query_grouped(&c, &cond, &gb("轴")).unwrap();
    assert_eq!(contents(&pages[0].notes), vec!["A2"]);
    assert_eq!(pages.len(), 1, "条件筛空 B 组后不出现在分组结果里");
    let page = query_group_page(&c, &cond, &gb("轴"), Some("轴/A"), 0).unwrap();
    assert_eq!(contents(&page), vec!["A2"]);
    let empty = query_group_page(&c, &cond, &gb("轴"), Some("轴/B"), 0).unwrap();
    assert!(empty.is_empty());
}
