//! T1.2 spec §3 五条缓存对账:正例 + 五条反例(每条至少命中一次)+ 重复跑不变;
//! 另加真库副本只读验收(`#[ignore]`,需 `LIFELOG_RECONCILE_DB`)。夹具全在内存库自建自删。
use super::reconcile::{
    assert_cache_matches_edges, check_1_parent_child, check_2_path, check_3_depth,
    check_4_single_parent, check_5_dangling, counts,
};
use super::reconcile_mirror::assert_mirror_matches_legacy;
use super::TAG_ID_OFFSET;
use crate::db::migrate;
use rusqlite::Connection;

/// 重放迁移 024 的 SQL:先把老表数据摆好,再投影进 `entities`/`edges`(INSERT OR IGNORE,幂等)。
fn project_024(c: &Connection) {
    let sql = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/db/migrations/024_entities_tags.sql"
    ));
    c.execute_batch(sql).unwrap();
}

fn add_tag(c: &Connection, id: i64, name: &str, parent: Option<i64>, path: &str, depth: i64) {
    c.execute(
        "INSERT INTO tags(id, name, parent_id, path, depth, sort_order) VALUES(?1,?2,?3,?4,?5,0)",
        rusqlite::params![id, name, parent, path, depth],
    )
    .unwrap();
}

/// 一致 v24 夹具:3 个标签(1 根 + 2 子)、2 条 child 边、1 条 tag 型关系(带属性名)、
/// 1 条 note 型链接(阶段 1 不搬进 edges)。
fn consistent_v24() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    add_tag(&c, 1, "地点轴", None, "地点轴", 1);
    add_tag(&c, 2, "日本", Some(1), "地点轴/日本", 2);
    add_tag(&c, 3, "中国", Some(1), "地点轴/中国", 2);
    c.execute(
        "INSERT INTO tag_links(tag_id, target_type, target_id, remark) VALUES(3,'tag',2,'国籍')",
        [],
    )
    .unwrap();
    c.execute(
        "INSERT INTO tag_links(tag_id, target_type, target_id, remark) VALUES(2,'note',501,'')",
        [],
    )
    .unwrap();
    project_024(&c);
    c
}

/// 正例:五条对账 + 四组镜像逐值全过,计数与老表一致。
#[test]
fn consistent_v24_passes_five_and_mirror() {
    let c = consistent_v24();
    assert_cache_matches_edges(&c);
    assert_mirror_matches_legacy(&c);
    assert!(
        super::reconcile_mirror::TAGS_MIRROR.contains(&TAG_ID_OFFSET.to_string()),
        "镜像 SQL 的 id 偏移必须与 TAG_ID_OFFSET 一致"
    );
    let n = counts(&c).unwrap();
    assert_eq!(n.tags, Some(3));
    assert_eq!(n.entities_tag, Some(3));
    assert_eq!(n.child, Some(2));
    assert_eq!(n.relation, Some(1));
    assert_eq!(n.tagging, Some(0));
    assert_eq!(n.link, Some(0));
}

/// 反例 ①:只改缓存的 `parent_id`(不删 child 边),对账 ① 必须命中该 path。
#[test]
fn reconcile_detects_parent_id_drift() {
    let c = consistent_v24();
    c.execute("UPDATE entities SET parent_id=NULL WHERE path='地点轴/中国'", [])
        .unwrap();
    let rows = check_1_parent_child(&c).unwrap();
    assert_eq!(rows.len(), 1, "① 应命中 1 行: {rows:?}");
    assert!(rows[0].contains("地点轴/中国"), "命中行应含漂移标签: {rows:?}");
}

/// 反例 ②:把某条 `path` 改错一位,对账 ② 必须命中。
#[test]
fn reconcile_detects_path_mismatch() {
    let c = consistent_v24();
    c.execute("UPDATE entities SET path='地点轴/中国X' WHERE path='地点轴/中国'", [])
        .unwrap();
    let rows = check_2_path(&c).unwrap();
    assert_eq!(rows.len(), 1, "② 应命中 1 行: {rows:?}");
}

/// 反例 ③:把某条 `depth` 改错,对账 ③ 必须命中。
#[test]
fn reconcile_detects_depth_mismatch() {
    let c = consistent_v24();
    c.execute("UPDATE entities SET depth=9 WHERE path='地点轴/中国'", [])
        .unwrap();
    let rows = check_3_depth(&c).unwrap();
    assert_eq!(rows.len(), 1, "③ 应命中 1 行: {rows:?}");
}

/// 反例 ④:手工插一条重复 `child` 入边(第二父),对账 ④ 必须命中。
#[test]
fn reconcile_detects_duplicate_child_edge() {
    let c = consistent_v24();
    c.execute(
        "INSERT INTO edges(source_id, target_id, kind, remark, created_at)
         VALUES(?1, ?2, 'child', '', datetime('now'))",
        rusqlite::params![3 + TAG_ID_OFFSET, 2 + TAG_ID_OFFSET],
    )
    .unwrap();
    let rows = check_4_single_parent(&c).unwrap();
    assert_eq!(rows.len(), 1, "④ 应命中 1 行: {rows:?}");
}

/// 反例 ⑤:插一条 target 指向不存在实体的 child 边(关外键绕开约束,模拟历史脏边),
/// 对账 ⑤ 与全 kind 悬挂检查都必须命中。
#[test]
fn reconcile_detects_dangling_edge() {
    let c = consistent_v24();
    c.pragma_update(None, "foreign_keys", "OFF").unwrap();
    c.execute(
        "INSERT INTO edges(source_id, target_id, kind, remark, created_at)
         VALUES(?1, 999999999, 'child', '', datetime('now'))",
        rusqlite::params![1 + TAG_ID_OFFSET],
    )
    .unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    let rows = check_5_dangling(&c).unwrap();
    assert_eq!(rows.len(), 1, "⑤ 应命中 1 行: {rows:?}");
    assert!(
        !super::reconcile::run_check(&c, super::reconcile_mirror::DANGLING_EDGES)
            .unwrap()
            .is_empty(),
        "全 kind 悬挂检查也应命中"
    );
}

/// 重复跑对账/迁移不变:同一库连跑两次五条对账,并重放 024,读数与结果都不变。
#[test]
fn reconcile_repeat_run_is_stable() {
    let c = consistent_v24();
    let before = counts(&c).unwrap();
    assert_cache_matches_edges(&c);
    assert_cache_matches_edges(&c);
    project_024(&c);
    let after = counts(&c).unwrap();
    assert_eq!(before, after, "重放迁移 024 改变了对账读数");
    assert_cache_matches_edges(&c);
    assert_mirror_matches_legacy(&c);
}

/// 真库副本只读验收(默认跳过)。用法:
/// `LIFELOG_RECONCILE_DB=F:/0-code/_lifelog-snapshots/lifelog.db.bak-p01-trial24.db \
///  cargo test --lib reconcile_real_db_readonly -- --ignored --nocapture`
#[test]
#[ignore = "真库只读验收:需 LIFELOG_RECONCILE_DB 指向 v24 副本"]
fn reconcile_real_db_readonly() {
    let path = std::env::var("LIFELOG_RECONCILE_DB")
        .expect("未设 LIFELOG_RECONCILE_DB(指向 v24 副本路径)");
    let c = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .unwrap();
    assert_cache_matches_edges(&c);
    assert_mirror_matches_legacy(&c);
    let n = counts(&c).unwrap();
    println!("真库副本读数: {n:?}");
    assert_eq!(n.entities_tag, n.tags, "标签投影数必须与老表一致");
    assert_eq!(n.child, Some(717), "阶段 1 副本 child 边应为 717");
}
