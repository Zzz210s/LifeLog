//! 基集「排除纯名字点」的用例(T2.2 / 计划 P0-8):信息流基集与 <3 字关键词退化两条。
//! 夹具直接落 `points` / `lines` —— 写路径(stage 3)尚未切点线,本用例不依赖它。
use crate::db::migrate;
use crate::db::repos::notes::{notes_filter::*, query as query_all};
use rusqlite::Connection;

/// 内存 v31 库:点 1 / 2 是多行内容点,点 3 只出现在 `name_id` 位 = 纯名字点。
fn db_with_pure_name() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c.execute_batch(
        "INSERT INTO points(id, meta, created_at, is_cited) VALUES
           (1, '苹果\n第二行', datetime('now','localtime'), 1),
           (2, '香蕉\n第二行', datetime('now','localtime'), 1),
           (3, '名字',        datetime('now','localtime'), 0);
         INSERT INTO lines(id, from_id, to_id, name_id, created_at)
           VALUES (1, 1, 2, 3, datetime('now','localtime'));",
    )
    .unwrap();
    c
}

fn keyword(k: &str) -> FilterConditions {
    FilterConditions { keyword: Some(k.to_string()), ..empty() }
}

#[test]
fn feed_excludes_pure_name_points() {
    let c = db_with_pure_name();
    let ids: Vec<i64> = query_all(&c, &empty(), 0).unwrap().iter().map(|n| n.id).collect();
    assert!(ids.contains(&1) && ids.contains(&2), "内容点应进基集:{ids:?}");
    assert!(!ids.contains(&3), "纯名字点(只在 name_id 位)不应进基集:{ids:?}");
}

#[test]
fn short_keyword_does_not_hit_pure_name_point() {
    let c = db_with_pure_name();
    let hit = query_all(&c, &keyword("名字"), 0).unwrap();
    let ids: Vec<i64> = hit.iter().map(|n| n.id).collect();
    assert!(ids.is_empty(), "2 字退化 LIKE 不得命中纯名字点:{ids:?}");
}

#[test]
fn short_keyword_still_matches_content() {
    let c = db_with_pure_name();
    let ids: Vec<i64> = query_all(&c, &keyword("苹果"), 0).unwrap().iter().map(|n| n.id).collect();
    assert_eq!(ids, vec![1], "2 字退化 LIKE 仍应命中正文");
}
