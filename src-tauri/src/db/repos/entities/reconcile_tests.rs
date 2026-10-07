//! T1.2 spec §3 五条缓存对账(阶段 4 起对 `entities`/`edges`):正例 + 五条反例
//! (每条至少命中一次)+ 重复跑不变;另加真库副本只读验收(`#[ignore]`)。
//! 阶段 1 的「镜像 == 老表」对账(`reconcile_mirror`)随 027 下架老表而退役。
use super::reconcile::{
    assert_cache_matches_edges, check_1_parent_child, check_2_path, check_3_depth,
    check_4_single_parent, check_5_dangling, counts,
};
use super::TAG_ID_OFFSET;
use crate::db::migrate;
use rusqlite::{params, Connection};

/// 标签实体(id 传老标签 id,内部加偏移)
fn add_tag(c: &Connection, id: i64, name: &str, parent: Option<i64>, path: &str, depth: i64) {
    c.execute(
        "INSERT INTO entities(id, kind, name, content, created_at, parent_id, path, depth, sort_order)
         VALUES(?1, 'tag', ?2, '', '2026-01-01', ?3, ?4, ?5, 0)",
        params![
            id + TAG_ID_OFFSET,
            name,
            parent.map(|p| p + TAG_ID_OFFSET),
            path,
            depth
        ],
    )
    .unwrap();
}

fn add_note(c: &Connection, id: i64, content: &str) {
    c.execute(
        "INSERT INTO entities(id, kind, content, created_at) VALUES(?1, 'note', ?2, '2026-01-01')",
        params![id, content],
    )
    .unwrap();
}

fn add_edge(c: &Connection, source: i64, target: i64, kind: &str, remark: &str) {
    c.execute(
        "INSERT INTO edges(source_id, target_id, kind, remark, created_at)
         VALUES(?1, ?2, ?3, ?4, '2026-01-01')",
        params![source, target, kind, remark],
    )
    .unwrap();
}

/// 一致夹具:3 个标签(1 根 + 2 子)、2 条 child 边、1 条 relation(带属性名)、
/// 1 条 tagging(笔记 501 -> 标签 2);link 刻意不建。
fn consistent() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    add_note(&c, 501, "第一篇 #地点轴/日本");
    add_tag(&c, 1, "地点轴", None, "地点轴", 1);
    add_tag(&c, 2, "日本", Some(1), "地点轴/日本", 2);
    add_tag(&c, 3, "中国", Some(1), "地点轴/中国", 2);
    add_edge(&c, 1 + TAG_ID_OFFSET, 2 + TAG_ID_OFFSET, "child", "");
    add_edge(&c, 1 + TAG_ID_OFFSET, 3 + TAG_ID_OFFSET, "child", "");
    add_edge(&c, 3 + TAG_ID_OFFSET, 2 + TAG_ID_OFFSET, "relation", "国籍");
    add_edge(&c, 501, 2 + TAG_ID_OFFSET, "tagging", "");
    c
}

/// 正例:五条对账全过,计数与库一致;老 `tags` 已在下架后为 `None`。
#[test]
fn consistent_entity_cache_passes_five() {
    let c = consistent();
    assert_cache_matches_edges(&c);
    let n = counts(&c).unwrap();
    assert_eq!(n.tags, None, "027 后老 tags 表不存在");
    assert_eq!(n.entities, Some(4));
    assert_eq!(n.entities_tag, Some(3));
    assert_eq!(n.child, Some(2));
    assert_eq!(n.tagging, Some(1));
    assert_eq!(n.relation, Some(1));
    assert_eq!(n.link, Some(0));
}

/// 反例 ①:只改缓存的 `parent_id`(不删 child 边),对账 ① 必须命中该 path。
#[test]
fn reconcile_detects_parent_id_drift() {
    let c = consistent();
    c.execute("UPDATE entities SET parent_id=NULL WHERE path='地点轴/中国'", []).unwrap();
    let rows = check_1_parent_child(&c).unwrap();
    assert_eq!(rows.len(), 1, "① 应命中 1 行: {rows:?}");
    assert!(rows[0].contains("地点轴/中国"), "命中行应含漂移标签: {rows:?}");
}

/// 反例 ②:把某条 `path` 改错一位,对账 ② 必须命中。
#[test]
fn reconcile_detects_path_mismatch() {
    let c = consistent();
    c.execute("UPDATE entities SET path='地点轴/中国X' WHERE path='地点轴/中国'", [])
        .unwrap();
    let rows = check_2_path(&c).unwrap();
    assert_eq!(rows.len(), 1, "② 应命中 1 行: {rows:?}");
}

/// 反例 ③:把某条 `depth` 改错,对账 ③ 必须命中。
#[test]
fn reconcile_detects_depth_mismatch() {
    let c = consistent();
    c.execute("UPDATE entities SET depth=9 WHERE path='地点轴/中国'", []).unwrap();
    let rows = check_3_depth(&c).unwrap();
    assert_eq!(rows.len(), 1, "③ 应命中 1 行: {rows:?}");
}

/// 反例 ④:手工插一条重复 `child` 入边(第二父),对账 ④ 必须命中。
#[test]
fn reconcile_detects_duplicate_child_edge() {
    let c = consistent();
    add_edge(&c, 3 + TAG_ID_OFFSET, 2 + TAG_ID_OFFSET, "child", "");
    let rows = check_4_single_parent(&c).unwrap();
    assert_eq!(rows.len(), 1, "④ 应命中 1 行: {rows:?}");
}

/// 反例 ⑤:插一条 target 指向不存在实体的 child 边(关外键绕开约束,模拟历史脏边),
/// 对账 ⑤ 必须命中。
#[test]
fn reconcile_detects_dangling_edge() {
    let c = consistent();
    c.pragma_update(None, "foreign_keys", "OFF").unwrap();
    add_edge(&c, 1 + TAG_ID_OFFSET, 999999999, "child", "");
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    let rows = check_5_dangling(&c).unwrap();
    assert_eq!(rows.len(), 1, "⑤ 应命中 1 行: {rows:?}");
}

/// 重复跑对账不变:同一库连跑两次五条对账,读数一致。
#[test]
fn reconcile_repeat_run_is_stable() {
    let c = consistent();
    let before = counts(&c).unwrap();
    assert_cache_matches_edges(&c);
    assert_cache_matches_edges(&c);
    let after = counts(&c).unwrap();
    assert_eq!(before, after);
}

/// 真库副本只读验收(默认跳过)。用法:
/// `LIFELOG_RECONCILE_DB=F:/0-code/_lifelog-snapshots/<副本>.db \
///  cargo test --lib reconcile_real_db_readonly -- --ignored --nocapture`
#[test]
#[ignore = "真库只读验收:需 LIFELOG_RECONCILE_DB 指向已有 entities/edges 的副本"]
fn reconcile_real_db_readonly() {
    let path = std::env::var("LIFELOG_RECONCILE_DB")
        .expect("未设 LIFELOG_RECONCILE_DB(指向副本路径)");
    let c = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .unwrap();
    assert_cache_matches_edges(&c);
    let n = counts(&c).unwrap();
    println!("真库副本读数: {n:?}");
}
