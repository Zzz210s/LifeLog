//! L4 关系图的笔记间链接边与信息条度数读数(内存库 + 真实迁移)。
//! 自 graph_tests.rs 分出是守 200 行红线;夹具自带,不引兄弟测试模块的私有件。
use super::*;
use crate::db::migrate;

/// 造数据:根 甲(id=10)下 甲/一(11)、甲/二(12);笔记 1 挂 甲/一 + 乙,笔记 2 挂 甲/二 + 乙
fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c.execute_batch(
        "INSERT INTO notes(id, content, created_at) VALUES (1,'甲','2026-01-01'),(2,'乙','2026-01-02');
         INSERT INTO tags(id,name,parent_id,path,depth) VALUES
           (10,'甲',NULL,'甲',1),(11,'一',10,'甲/一',2),(12,'二',10,'甲/二',2),(20,'乙',NULL,'乙',1);
         INSERT INTO tag_links(tag_id,target_type,target_id) VALUES
           (11,'note',1),(20,'note',1),(12,'note',2),(20,'note',2);",
    )
    .unwrap();
    c
}

/// 链接四态:已解析 / 未解析(target NULL)/ 自指 / 已解析的反向
fn with_links() -> Connection {
    let c = db();
    c.execute_batch(
        "INSERT INTO note_links(id,source_id,target_id,raw_title,created_at) VALUES
           (1,1,2,'乙','2026-01-01'),(2,2,1,'甲','2026-01-01'),
           (3,1,NULL,'没有这条笔记','2026-01-01'),(4,2,2,'自己','2026-01-01');",
    )
    .unwrap();
    c
}

#[test]
fn link_edges_keep_resolved_non_self_pairs_only() {
    let c = with_links();
    assert_eq!(
        link_edges(&c).unwrap(),
        vec![GraphLink { a: 1, b: 2 }, GraphLink { a: 2, b: 1 }],
        "未解析(target NULL)与自指都不出边;反向是两个端点各自的边,各留一条"
    );
}

#[test]
fn link_edges_empty_without_links() {
    let c = db();
    assert!(link_edges(&c).unwrap().is_empty());
}

#[test]
fn link_degrees_are_subtree_aggregates_of_resolved_links() {
    let c = with_links();
    // 甲(id=10)的子树含 甲/一、甲/二 -> 笔记 1、2 都在这支里
    assert_eq!(
        link_degrees(&c, 10).unwrap(),
        LinkDegrees { outbound: 2, backlinks: 2 },
        "出链 = 这两条笔记写出的已解析链接(2),入链 = 指向它们的已解析链接(2);未解析与自指不计"
    );
    // 叶子标签只算挂在自己身上的那条笔记
    assert_eq!(
        link_degrees(&c, 11).unwrap(),
        LinkDegrees { outbound: 1, backlinks: 1 },
        "甲/一 只含笔记 1:出链 1、入链 1"
    );
    assert_eq!(
        link_degrees(&c, 20).unwrap(),
        LinkDegrees { outbound: 2, backlinks: 2 },
        "乙 是根,没有子孙:本级两条笔记"
    );
}

#[test]
fn link_degrees_dedupe_note_tagged_in_both_ancestor_and_descendant() {
    let c = with_links();
    // 笔记 1 同时挂 甲 与 甲/一:子树聚合按 DISTINCT 链接 id 去重,不能按挂载次数算两遍
    c.execute("INSERT INTO tag_links(tag_id,target_type,target_id) VALUES (10,'note',1)", [])
        .unwrap();
    assert_eq!(
        link_degrees(&c, 10).unwrap(),
        LinkDegrees { outbound: 2, backlinks: 2 },
        "去重后与只挂叶子时一致(不去重会变成 3 / 3)"
    );
}

#[test]
fn link_degrees_zero_for_missing_tag() {
    let c = with_links();
    assert_eq!(
        link_degrees(&c, 999).unwrap(),
        LinkDegrees { outbound: 0, backlinks: 0 },
        "标签不存在不报错,两数都是 0"
    );
}
