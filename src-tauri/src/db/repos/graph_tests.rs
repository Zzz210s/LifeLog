//! 关系图仓库层读数(内存库 + 真实迁移):节点计数含子级去重、父子边、共现边排除枢纽。
use super::*;
use crate::commands::graph::HUB_THRESHOLD;
use crate::db::migrate;

/// 造数据:甲/乙 两个根,甲下 甲/一、甲/二;
/// 笔记 1 引 甲/一 + 乙,笔记 2 引 甲/二 + 乙(故 乙 出现 2 条、甲/一 与 甲/二 各 1 条);
/// 点 90 只在 `name_id` 位 = 纯名字点(不得进图节点)。
fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c.execute_batch(
        "INSERT INTO points(id,meta,is_cited,created_at,path,depth,parent_id) VALUES
           (10,'甲',0,'2026-01-01','甲',1,NULL),(11,'一',1,'2026-01-01','甲/一',2,10),
           (12,'二',1,'2026-01-01','甲/二',2,10),(20,'乙',1,'2026-01-01','乙',1,NULL),
           (90,'线名',0,'2026-01-01',NULL,NULL,NULL);
         INSERT INTO points(id,meta,created_at) VALUES
           (1,'a','2026-01-01'),(2,'b','2026-01-02');
         INSERT INTO lines(id,from_id,to_id,name_id) VALUES
           (1,10,11,0),(2,10,12,0),
           (3,1,11,90),(4,1,20,NULL),
           (5,2,12,NULL),(6,2,20,NULL);",
    )
    .unwrap();
    c
}

/// 图节点集合 = 闭包,纯名字点不得进(计划 T2.3 变异自证用例:把种子改成「全部点」即红)。
#[test]
fn graph_nodes_exclude_pure_name_points() {
    let c = db();
    let ns = nodes(&c).unwrap();
    let ids: Vec<i64> = ns.iter().map(|n| n.id).collect();
    assert!(!ids.contains(&90), "纯名字点(只在 name_id 位)不得成为图节点:{ids:?}");
    assert_eq!(ns.len(), 4, "闭包还是 甲 / 甲·一 / 甲·二 / 乙 四点");
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
fn nodes_carry_self_and_subtree_counts() {
    let c = db();
    let ns = nodes(&c).unwrap();
    let by = |p: &str| ns.iter().find(|n| n.path == p).unwrap().clone();
    assert_eq!(by("甲").notes, 2, "含子级");
    assert_eq!(by("甲").self_count, 0, "本级:甲 上没有直接挂笔记");
    assert_eq!(by("甲/一").self_count, 1);
    assert_eq!(by("乙").self_count, 2);
}

#[test]
fn nodes_carry_sort_order() {
    let c = db();
    c.execute("UPDATE points SET sort_order = 7 WHERE id = 20", [])
        .unwrap();
    let ns = nodes(&c).unwrap();
    assert_eq!(ns.iter().find(|n| n.path == "乙").unwrap().sort_order, 7);
    assert_eq!(
        ns.iter().find(|n| n.path == "甲/一").unwrap().sort_order,
        0,
        "没动过的标签保持默认 0"
    );
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

/// 枢纽判定是**严格大于**阈值,阈值取真值(`commands::graph::HUB_THRESHOLD`,T4.2 标定为 60):
/// 度数恰好等于阈值的标签仍参与共现,多一条才被排除 —— `>` 写成 `>=` 会让真实库里度数
/// 正好压在阈值上的标签整片消失,而拿小阈值试的用例看不出来。用例不写死 50/51,阈值改数
/// 时它跟着变,守的始终是“真实的那个数”。
#[test]
fn co_edges_hub_boundary_is_strictly_greater() {
    let c = db();
    let t = HUB_THRESHOLD;
    let mut batch = String::new();
    for i in 100..=(100 + t) {
        batch.push_str(&format!(
            "INSERT INTO points(id,meta,created_at) VALUES ({i},'x','2026-01-01');"
        ));
    }
    // 丙 = t 条笔记(恰好等于阈值)、丁 = t+1 条(枢纽);戊/己 是各自的共现对手方(5 / 11 条)
    batch.push_str(
        "INSERT INTO points(id,meta,created_at,path,depth) VALUES
           (30,'丙','2026-01-01','丙',1),(31,'丁','2026-01-01','丁',1),
           (40,'戊','2026-01-01','戊',1),(41,'己','2026-01-01','己',1);",
    );
    for i in 100..(100 + t) {
        batch.push_str(&format!(
            "INSERT INTO lines(from_id,to_id,name_id) VALUES ({i},30,NULL);"
        ));
    }
    for i in 100..=(100 + t) {
        batch.push_str(&format!(
            "INSERT INTO lines(from_id,to_id,name_id) VALUES ({i},31,NULL);"
        ));
    }
    for i in 100..105 {
        batch.push_str(&format!(
            "INSERT INTO lines(from_id,to_id,name_id) VALUES ({i},40,NULL);"
        ));
    }
    for i in 100..111 {
        batch.push_str(&format!(
            "INSERT INTO lines(from_id,to_id,name_id) VALUES ({i},41,NULL);"
        ));
    }
    c.execute_batch(&batch).unwrap();

    let es = co_edges(&c, HUB_THRESHOLD).unwrap();
    let edge = |a: i64, b: i64| es.iter().find(|e| e.a == a && e.b == b).map(|e| e.weight);
    assert_eq!(
        edge(30, 40),
        Some(5),
        "丙 恰好 {t} 条笔记 = 阈值,不是枢纽,与 戊 的边应在(权重 5)"
    );
    assert_eq!(edge(31, 41), None, "丁 是枢纽:丁-己 这条边的一端被排除");
    assert!(
        es.iter().all(|e| e.a != 31 && e.b != 31),
        "丁 出现在 {} 条笔记上,两端都不参与",
        t + 1
    );
}

/// 共现边无向去重:`a.tag_id < b.tag_id` 保证每对只出现一次(不含反向、不含自指),
/// 权重是共同出现的**笔记数**。
#[test]
fn co_edges_are_undirected_once_with_note_count_weight() {
    let c = db();
    c.execute_batch(
        "INSERT INTO points(id,meta,created_at) VALUES (3,'c','2026-01-03'),(4,'d','2026-01-04');
         INSERT INTO points(id,meta,created_at,path,depth) VALUES
           (30,'丙','2026-01-03','丙',1),(31,'丁','2026-01-03','丁',1);
         INSERT INTO lines(from_id,to_id,name_id) VALUES
           (3,30,NULL),(3,31,NULL),
           (4,30,NULL),(4,31,NULL);",
    )
    .unwrap();
    let es = co_edges(&c, 99).unwrap();
    let pair: Vec<&GraphEdge> = es.iter().filter(|e| (e.a, e.b) == (30, 31)).collect();
    assert_eq!(pair.len(), 1, "(30,31) 只出现一次,反向 (31,30) 不重复");
    assert_eq!(pair[0].weight, 2, "不在同一条笔记上的两次共现不算:权重 = 共同笔记数 2");
    assert!(
        es.iter().all(|e| e.a < e.b),
        "所有边恒为 a < b:既无自指也无反向重复"
    );
}
