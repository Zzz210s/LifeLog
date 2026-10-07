//! 标签关系数据层测试(设计 2026-10-06 §4 / 计划 Task 1):
//! 一条边 `(A,'tag',B)` = 「A 具有 B 所表示的属性」;任何标签都可被指向(is_type 已取消);
//! 幂等、自指向/2 环/3 环被拒。全部用内存库;真实库只读。
//! 读方审计(删除清边 / gc 保护 / FTS / 导出 / 备注)拆到 `relation_read_tests.rs`(守 200 行上限)。
use super::*;
use crate::db::{migrate, repos};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    crate::db::repos::tags::test_support::install_entity_views(&c);
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    c
}

fn ensure(c: &Connection, path: &str) -> i64 {
    repos::tags::ensure_path(c, &[path.to_string()]).unwrap()
}

/// 当前关系边数(唯一存储读数)
fn relation_edges(c: &Connection) -> i64 {
    c.query_row(
        "SELECT COUNT(*) FROM tag_links WHERE target_type='tag'",
        [],
        |r| r.get(0),
    )
    .unwrap()
}

/// ① 建立关系:多一行边;list 方向是 A -> B(出边),不是双向
#[test]
fn set_relation_adds_edge_and_lists_out_edges() {
    let mut c = db();
    let jia = ensure(&c, "甲");
    let yi = ensure(&c, "乙");
    assert_eq!(relation_edges(&c), 0);

    set_tag_relation(&mut c, jia, yi, "").unwrap();

    assert_eq!(relation_edges(&c), 1);
    let out = list_tag_relations(&c, jia).unwrap();
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].to_tag_id, yi);
    assert_eq!(out[0].path, "乙");
    assert_eq!(out[0].name, "乙");
    assert_eq!(out[0].remark, "");
    assert!(list_tag_relations(&c, yi).unwrap().is_empty(), "反向不是出边");
}

/// ② 幂等:重复建立不增行,list 仍只一条
#[test]
fn set_relation_is_idempotent() {
    let mut c = db();
    let jia = ensure(&c, "甲");
    let yi = ensure(&c, "乙");
    set_tag_relation(&mut c, jia, yi, "").unwrap();
    set_tag_relation(&mut c, jia, yi, "").unwrap();
    assert_eq!(relation_edges(&c), 1);
    assert_eq!(list_tag_relations(&c, jia).unwrap().len(), 1);
}

/// ③ 任何标签都可被指向:目标从没「登记为类型」,关系照样建立(R2)
#[test]
fn any_tag_can_be_a_relation_target() {
    let mut c = db();
    let author = ensure(&c, "作者/丸尾");
    let guo = ensure(&c, "地点轴/国籍");
    set_tag_relation(&mut c, author, guo, "").unwrap();
    assert_eq!(relation_edges(&c), 1);
    assert_eq!(count_relations_to(&c, guo).unwrap(), 1);
    assert_eq!(count_relations_to(&c, author).unwrap(), 0, "出边方不算入边");
}

/// ④ 自指向被拒且不写库
#[test]
fn set_relation_rejects_self_reference() {
    let mut c = db();
    let jia = ensure(&c, "甲");
    let err = set_tag_relation(&mut c, jia, jia, "").unwrap_err();
    assert!(err.contains("自己"), "要中文提示不能指向自己: {err}");
    assert_eq!(relation_edges(&c), 0);
}

/// ⑤ A→B→A 环被拒且不写第二行
#[test]
fn set_relation_rejects_two_node_cycle() {
    let mut c = db();
    let a = ensure(&c, "甲");
    let b = ensure(&c, "乙");
    set_tag_relation(&mut c, a, b, "").unwrap();
    let err = set_tag_relation(&mut c, b, a, "").unwrap_err();
    assert!(err.contains("循环"), "要中文提示会形成循环: {err}");
    assert_eq!(relation_edges(&c), 1);
}

/// ⑥ A→B→C→A 环被拒且不写第三行
#[test]
fn set_relation_rejects_three_node_cycle() {
    let mut c = db();
    let a = ensure(&c, "甲");
    let b = ensure(&c, "乙");
    let d = ensure(&c, "丙");
    set_tag_relation(&mut c, a, b, "").unwrap();
    set_tag_relation(&mut c, b, d, "").unwrap();
    let err = set_tag_relation(&mut c, d, a, "").unwrap_err();
    assert!(err.contains("循环"), "要中文提示会形成循环: {err}");
    assert_eq!(relation_edges(&c), 2);
}

/// ⑦ 移除:行消失;重复移除仍成功(幂等)
#[test]
fn remove_relation_deletes_edge_and_is_idempotent() {
    let mut c = db();
    let jia = ensure(&c, "甲");
    let yi = ensure(&c, "乙");
    set_tag_relation(&mut c, jia, yi, "").unwrap();
    remove_tag_relation(&mut c, jia, yi).unwrap();
    assert_eq!(relation_edges(&c), 0);
    assert!(list_tag_relations(&c, jia).unwrap().is_empty());
    remove_tag_relation(&mut c, jia, yi).unwrap(); // 幂等:再删一次不报错
    assert_eq!(relation_edges(&c), 0);
}

/// ⑧ 不存在的标签给中文报错(两端都校验)
#[test]
fn set_relation_rejects_missing_tag() {
    let mut c = db();
    let jia = ensure(&c, "甲");
    let err = set_tag_relation(&mut c, jia, 999_999, "").unwrap_err();
    assert!(err.contains("不存在"), "目标不存在要给中文错: {err}");
    let err = set_tag_relation(&mut c, 999_999, jia, "").unwrap_err();
    assert!(err.contains("不存在"), "起点不存在要给中文错: {err}");
    assert_eq!(relation_edges(&c), 0);
}
