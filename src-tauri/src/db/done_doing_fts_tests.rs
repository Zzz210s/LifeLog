//! 迁移 013 的 FTS 读数(自 `done_doing_migration_tests.rs` 拆出以守 200 行红线):
//! `done` 关键词删后不再命中,正文关键词仍命中(老库停在 v12,升级读终态 `entities_fts`)。
use super::entities_tags_fixture::db_at_012;
use super::*;
use crate::db::repos::notes::notes_filter::empty;
use crate::db::repos::notes::{query, FilterConditions};

#[test]
fn fts_loses_done_but_keeps_body_keyword() {
    let c = db_at_012();
    // 精简夹具:只一条笔记 + 一个 done 标签,单独钉 FTS 行为
    c.execute_batch(
        "INSERT INTO notes(id, content, created_at) VALUES(1,'买牛奶','2026-01-01');
         INSERT INTO tags(id, name, parent_id, path, depth, sort_order) VALUES(1,'done',NULL,'done',1,0);
         INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(1,'note',1);",
    )
    .unwrap();
    let pre: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH 'done'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(pre, 1, "前置:done 可检索(此时尚无 entities_fts,读老索引)");

    run(&c).unwrap();

    let kw = |k: &str| FilterConditions { keyword: Some(k.into()), ..empty() };
    assert!(query(&c, &kw("done"), 0).unwrap().is_empty(), "删后 done 不再命中");
    assert_eq!(query(&c, &kw("买牛奶"), 0).unwrap().len(), 1, "正文关键词仍命中");
}
