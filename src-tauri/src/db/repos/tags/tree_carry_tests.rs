//! 标签携带标签的清理口径测试(Task 4 / spec 2026-10-05 §3 R2 R5 §7):
//! 孤儿回收认识"被携带"、删除子树清理指向它的携带行、合并时携带行的自携带/悬空/成环处理。
//! 判据复用 invariants_tests 的共享检查台(孤儿/悬空携带行/携带无环),不再各写一份。
use super::*;
use crate::db::repos::notes;
use crate::db::repos::tags::invariants_tests::{
    assert_carry_acyclic, assert_no_dangling_carries, assert_no_orphan_tags,
};
use crate::db::repos::tags::{merge_tags, set_tag_relation};
use crate::db::migrate;
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    crate::db::repos::tags::test_support::install_legacy_name_views(&c);
    c
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", params![path], |r| r.get(0))
        .unwrap()
}

fn segs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

/// 指向某标签的携带行数(被携带方向)
fn incoming_carries(c: &Connection, carried_id: i64) -> i64 {
    count(
        c,
        &format!(
            "SELECT COUNT(*) FROM tag_links WHERE target_type='tag' AND target_id={carried_id}"
        ),
    )
}

/// R2:只被携带、没有笔记也没有子标签的空壳标签不被回收;无关空壳仍被回收
#[test]
fn gc_orphans_keeps_carried_tag() {
    let c = db();
    let carried = ensure_path(&c, &segs(&["出版年份"])).unwrap();
    let carrier = ensure_path(&c, &segs(&["作者"])).unwrap();
    let junk = ensure_path(&c, &segs(&["空壳"])).unwrap();
    // 直接建携带行:本用例只关心 gc 判据,不经过 set_tag_relation 的校验与事务
    c.execute(
        "INSERT INTO edges(source_id, target_id, kind, remark, created_at)
         VALUES(?1, ?2, 'link', '', datetime('now', 'localtime'))",
        params![carrier, carried],
    )
    .unwrap();

    gc_orphans(&c).unwrap();

    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={carried}")),
        1,
        "被携带的标签不是孤儿,必须留下"
    );
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={carrier}")),
        1,
        "携带者有携带行,不是孤儿"
    );
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={junk}")),
        0,
        "无关空壳仍要被回收"
    );
}

/// R5:删掉被携带的标签后,指向它的携带行必须清干净(不留悬空行)
#[test]
fn delete_subtree_cleans_incoming_carry_rows() {
    let mut c = db();
    // 先建带链接的携带者:create_plain 会跑孤儿回收,后建的"被携带"标签才不会当场被回收
    notes::create_plain(&mut c, "a #携带者").unwrap();
    let carrier = id_at(&c, "携带者");
    let carried = ensure_path(&c, &segs(&["被携带"])).unwrap();
    set_tag_relation(&mut c, carrier, carried, "").unwrap();
    assert_eq!(incoming_carries(&c, carried), 1, "前置:一条指向被删标签的携带行");

    delete_subtree(&mut c, carried).unwrap();

    assert_eq!(
        incoming_carries(&c, carried),
        0,
        "指向已删标签的携带行必须清干净"
    );
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={carried}")),
        0,
        "标签本身已删"
    );
    assert_no_dangling_carries(&c);
    assert_carry_acyclic(&c);
}

/// 合并:源携带目标时,不得把携带行迁成 (目标,'tag',目标) 自携带(S3)
#[test]
fn merge_source_carrying_target_leaves_no_self_carry() {
    let mut c = db();
    notes::create_plain(&mut c, "a #源").unwrap();
    let src = id_at(&c, "源");
    let dst = ensure_path(&c, &segs(&["目标"])).unwrap();
    set_tag_relation(&mut c, src, dst, "").unwrap();

    merge_tags(&mut c, src, dst, false).unwrap();

    assert_eq!(
        count(
            &c,
            &format!(
                "SELECT COUNT(*) FROM tag_links WHERE target_type='tag' AND tag_id={dst} AND target_id={dst}"
            )
        ),
        0,
        "不得出现自携带行"
    );
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM tag_links WHERE target_type='tag'"),
        0,
        "源的携带行随源一起消失(源携带的目标不迁成自携带,也不凭空多出)"
    );
    assert_no_dangling_carries(&c);
    assert_carry_acyclic(&c);
}

/// 合并:源是被携带者时,删掉源后不得留下指向源 id 的悬空携带行
#[test]
fn merge_carried_source_leaves_no_dangling_carry() {
    let mut c = db();
    notes::create_plain(&mut c, "a #源").unwrap();
    notes::create_plain(&mut c, "b #目标").unwrap();
    notes::create_plain(&mut c, "c #甲").unwrap();
    let src = id_at(&c, "源");
    let dst = id_at(&c, "目标");
    let jia = id_at(&c, "甲");
    set_tag_relation(&mut c, jia, src, "").unwrap();

    merge_tags(&mut c, src, dst, false).unwrap();

    assert_eq!(
        incoming_carries(&c, src),
        0,
        "指向已删源的携带行必须清干净(悬空行)"
    );
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={jia}")), 1, "甲仍存在");
    assert_no_dangling_carries(&c);
    assert_carry_acyclic(&c);
    assert_no_orphan_tags(&c);
}

/// 合并:R3 无环 —— 源携带 X、X 携带目标时,不得迁出 目标→X 与 X→目标 的 2 环
#[test]
fn merge_source_carrying_x_which_carries_target_leaves_no_cycle() {
    let mut c = db();
    notes::create_plain(&mut c, "a #源").unwrap();
    notes::create_plain(&mut c, "b #目标").unwrap();
    let src = id_at(&c, "源");
    let dst = id_at(&c, "目标");
    let x = ensure_path(&c, &segs(&["X"])).unwrap();
    set_tag_relation(&mut c, src, x, "").unwrap();
    set_tag_relation(&mut c, x, dst, "").unwrap();

    merge_tags(&mut c, src, dst, false).unwrap();

    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE target_type='tag' AND tag_id={dst} AND target_id={x}")),
        0,
        "目标→X 会与 X→目标 成环,必须剔除"
    );
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE target_type='tag' AND tag_id={x} AND target_id={dst}")),
        1,
        "X→目标 原样保留"
    );
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={src}")), 0, "源已删");
    assert_no_dangling_carries(&c);
    assert_carry_acyclic(&c);
}

#[cfg(test)]
#[path = "tree_carry_invariant_tests.rs"]
mod invariant;
