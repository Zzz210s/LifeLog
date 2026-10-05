//! 标签携带标签的清理口径测试(Task 4 / spec 2026-10-05 §3 R2 R5 §7):
//! 孤儿回收认识"被携带"、删除子树清理指向它的携带行、合并时携带行的自携带/悬空处理。
use super::*;
use crate::db::repos::notes;
use crate::db::repos::tags::{merge_tags, set_carry};
use crate::db::migrate;
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
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

/// 无孤儿(含"被携带"这一新理由):无 tag_id 链接、无指向它的携带行、无子节点
fn assert_no_orphan_tags(c: &Connection) {
    let n = count(
        c,
        "SELECT COUNT(*) FROM tags t
          WHERE NOT EXISTS (SELECT 1 FROM tag_links l WHERE l.tag_id = t.id)
            AND NOT EXISTS (SELECT 1 FROM tag_links lc WHERE lc.target_type='tag' AND lc.target_id = t.id)
            AND NOT EXISTS (SELECT 1 FROM tags ch WHERE ch.parent_id = t.id)",
    );
    assert_eq!(n, 0, "存在孤儿标签");
}

/// R2:只被携带、没有笔记也没有子标签的空壳标签不被回收;无关空壳仍被回收
#[test]
fn gc_orphans_keeps_carried_tag() {
    let c = db();
    let carried = ensure_path(&c, &segs(&["出版年份"])).unwrap();
    let carrier = ensure_path(&c, &segs(&["作者"])).unwrap();
    let junk = ensure_path(&c, &segs(&["空壳"])).unwrap();
    // 直接建携带行:本用例只关心 gc 判据,不经过 set_carry 的校验与事务
    c.execute(
        "INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(?1, 'tag', ?2)",
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
    set_carry(&mut c, carrier, carried).unwrap();
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
}

/// 合并:源携带目标时,不得把携带行迁成 (目标,'tag',目标) 自携带(S3)
#[test]
fn merge_source_carrying_target_leaves_no_self_carry() {
    let mut c = db();
    notes::create_plain(&mut c, "a #源").unwrap();
    let src = id_at(&c, "源");
    let dst = ensure_path(&c, &segs(&["目标"])).unwrap();
    set_carry(&mut c, src, dst).unwrap();

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
    set_carry(&mut c, jia, src).unwrap();

    merge_tags(&mut c, src, dst, false).unwrap();

    assert_eq!(
        incoming_carries(&c, src),
        0,
        "指向已删源的携带行必须清干净(悬空行)"
    );
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={jia}")), 1, "甲仍存在");
    assert_no_orphan_tags(&c);
}
