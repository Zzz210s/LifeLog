//! 关系图仓库层读数(内存库 + 真实迁移):节点计数含子级去重、父子边、共现边排除枢纽。
use super::*;
use crate::db::migrate;

/// 造数据:甲/乙 两个根,甲下 甲/一、甲/二;
/// 笔记 1 挂 甲/一 + 乙,笔记 2 挂 甲/二 + 乙(故 乙 出现 2 条、甲/一 与 甲/二 各 1 条)
fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c.execute_batch(
        "INSERT INTO notes(id, content, created_at) VALUES (1,'a','2026-01-01'),(2,'b','2026-01-02');
         INSERT INTO tags(id,name,parent_id,path,depth) VALUES
           (10,'甲',NULL,'甲',1),(11,'一',10,'甲/一',2),(12,'二',10,'甲/二',2),(20,'乙',NULL,'乙',1);
         INSERT INTO tag_links(tag_id,target_type,target_id) VALUES
           (11,'note',1),(20,'note',1),(12,'note',2),(20,'note',2);",
    )
    .unwrap();
    c
}

#[test]
fn nodes_carry_subtree_note_counts() {
    let c = db();
    let ns = nodes(&c).unwrap();
    let by = |p: &str| ns.iter().find(|n| n.path == p).unwrap().clone();
    assert_eq!(by("甲").notes, 2, "含子级 = 2 条笔记");
    assert_eq!(by("甲/一").notes, 1);
    assert_eq!(by("乙").notes, 2);
    assert_eq!(by("甲").parent, None);
    assert_eq!(by("甲/一").parent, Some(10));
    assert_eq!(ns.len(), 4);
    assert_eq!(ns[0].path, "乙", "按 path 升序");
}

#[test]
fn tree_edges_are_parent_child() {
    let c = db();
    let es = tree_edges(&c).unwrap();
    // 甲 下两个孩子 => 2 条(乙 是根,没有入边);计划里写的 3 与它自己的夹具不符,按事实钉 2
    assert_eq!(es.len(), 2);
    assert!(es.iter().all(|e| e.kind == EdgeKind::Tree));
    assert_eq!(es[0].a, 10, "父在前");
    assert_eq!(es[0].b, 11);
    assert_eq!(es[0].weight, 1);
    let pairs: Vec<(i64, i64)> = es.iter().map(|e| (e.a, e.b)).collect();
    assert_eq!(pairs, vec![(10, 11), (10, 12)]);
}

#[test]
fn co_edges_exclude_hubs() {
    let c = db();
    // 阈值为 1 时 乙(出现 2 条)是枢纽:甲乙之间没有共现,剩下的 甲/一 与 甲/二 也没共同笔记
    assert_eq!(co_edges(&c, 1).unwrap().len(), 0, "阈值 1:乙 被排除");
    // 阈值为 99 时无枢纽,两条边:(乙,甲/一) 与 (乙,甲/二)
    let es = co_edges(&c, 99).unwrap();
    assert_eq!(es.len(), 2);
    assert!(es.iter().all(|e| e.kind == EdgeKind::Co));
    assert!(es.iter().all(|e| e.weight == 1));
    assert_eq!(es[0].a, 11, "按 a 升序:(11,20) 在 (12,20) 前");
    assert_eq!(es[0].b, 20);
}
