//! 粗粒度时间标签(只有年/月级、裸根)与普通标签完全一样(spec 2026-09-17 D3):
//! 可以按路径筛选、可以含子级展开;日期派生(旧 `date` 字段)已随 D2 一起取消。
use crate::db::migrate;
use crate::db::repos::notes::notes_filter::*;
use crate::db::repos::notes::notes_query::query;
use crate::db::repos::notes::create_plain;
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn f(path: &str, include_children: bool) -> FilterConditions {
    FilterConditions {
        tags: vec![TagCond { path: path.to_string(), include_children }],
        ..empty()
    }
}

fn contents(c: &Connection, cond: &FilterConditions) -> Vec<String> {
    query(c, cond, 0).unwrap().iter().map(|n| n.content.clone()).collect()
}

#[test]
fn coarse_time_tags_are_ordinary_tags() {
    let mut c = db();
    create_plain(&mut c, "只有月 #时间排序/2026/09").unwrap();
    create_plain(&mut c, "只有年 #时间排序/2025").unwrap();
    create_plain(&mut c, "裸根 #时间排序").unwrap();
    create_plain(&mut c, "深路径 #时间排序/2026/09/15/子级").unwrap();
    create_plain(&mut c, "无关").unwrap();

    // 裸根本级只命中直接挂在根上的笔记
    assert_eq!(contents(&c, &f("时间排序", false)), vec!["裸根"]);
    // 年/月级节点照常按路径筛选
    assert_eq!(contents(&c, &f("时间排序/2025", false)), vec!["只有年"]);
    assert_eq!(contents(&c, &f("时间排序/2026", true)), vec!["深路径", "只有月"], "含子级命中月与更深路径");
    assert_eq!(contents(&c, &f("时间排序/2026/09", false)), vec!["只有月"]);
    assert_eq!(contents(&c, &f("时间排序/2026/09/15/子级", false)), vec!["深路径"]);
    // 裸根含子级 = 整棵时间子树(与普通标签前缀语义一致)
    assert_eq!(contents(&c, &f("时间排序", true)).len(), 4);
}

/// 粗粒度标签不影响"无标签"判定:它同样是标签(D3)
#[test]
fn coarse_time_tag_counts_as_a_tag() {
    let mut c = db();
    create_plain(&mut c, "只有年 #时间排序/2025").unwrap();
    create_plain(&mut c, "真空").unwrap();

    let none = FilterConditions { tag_presence: Some("none".into()), ..empty() };
    let any = FilterConditions { tag_presence: Some("any".into()), ..empty() };

    assert_eq!(contents(&c, &none), vec!["真空"]);
    assert_eq!(contents(&c, &any), vec!["只有年"]);
}
