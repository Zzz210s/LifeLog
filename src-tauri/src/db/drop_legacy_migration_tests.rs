//! 迁移 027 核心读数:老表/老触发器/老 FTS/过渡视图全消失;漂移回填;完整性;
//! v24/v25/v26 各一次 `run` 跑到最新(29)与重放幂等。
//! (026/027 内联聚合的守卫已随 029 退役:聚合唯一真源改由常量拼视图,守卫见
//! `entities_fts_migration_tests::entities_fts_src_view_matches_rust_truth`。)
use super::entities_tags_fixture::{count, migrate_to_v23, migrated_to_v26, seed_notes, seed_v23};
use super::*;
use rusqlite::Connection;

/// 记忆 #1290 的 8 个老触发器;027 一个不留。
const LEGACY_TRIGGERS: [&str; 8] = [
    "notes_ad", "notes_ai", "notes_au", "tag_aliases_ad", "tag_aliases_ai", "tag_aliases_au",
    "tag_links_ad", "tag_links_ai",
];

/// 老表 / 老 FTS(含影子表)/ 老触发器 / 过渡视图都必须不在 `sqlite_master` 里。
fn assert_legacy_gone(c: &Connection) {
    // `entities_fts_src` 不在下架名单:它是 029 重建的 FTS 聚合视图,不是老表遗留
    for gone in [
        "notes", "tags", "tag_links", "note_links", "notes_fts", "tag_aliases", "tag_merge_log",
    ] {
        assert_eq!(
            count(c, &format!("SELECT COUNT(*) FROM sqlite_master WHERE name='{gone}'")),
            0,
            "老对象应已下架: {gone}"
        );
    }
    assert_eq!(
        count(c, "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'notes_fts%'"),
        0,
        "notes_fts 影子表也必须清掉"
    );
    for t in LEGACY_TRIGGERS {
        assert_eq!(
            count(c, &format!("SELECT COUNT(*) FROM sqlite_master WHERE name='{t}'")),
            0,
            "老触发器应已下架: {t}"
        );
    }
}

fn fk_violations(c: &Connection) -> i64 {
    let mut stmt = c.prepare("PRAGMA foreign_key_check").unwrap();
    stmt.query_map([], |_| Ok(())).unwrap().count() as i64
}

/// v24(024 已跑,025/026/027 待跑)
fn at_v24() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v23(&c);
    seed_v23(&c);
    seed_notes(&c);
    apply(&c, MIGRATIONS[23], 24).unwrap();
    c
}

/// ① v26 -> v27 后老对象全消失;五条缓存对账仍绿;完整性 ok。
#[test]
fn v27_drops_legacy_and_stays_reconciled() {
    let c = migrated_to_v26();
    run(&c).unwrap();
    assert_eq!(count(&c, "PRAGMA user_version"), latest_version());
    assert_legacy_gone(&c);
    assert_eq!(fk_violations(&c), 0, "foreign_key_check 必须空");
    let ok: String = c.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
    assert_eq!(ok, "ok");
    crate::db::repos::entities::reconcile::assert_cache_matches_edges(&c);
}

/// ② 漂移回填:老表比新表多一条笔记 + 一个标签(真库形态),027 必须补进实体并建边。
#[test]
fn drift_rows_are_backfilled_before_legacy_drop() {
    let c = migrated_to_v26();
    // 阶段 3 快照后应用仍写过老表:notes 多 1 条、tags 多 1 个、tag_links 多 1 条
    c.execute(
        "INSERT INTO notes(id, content, created_at) VALUES(503,'漂移笔记','2026-01-03')",
        [],
    )
    .unwrap();
    c.execute(
        "INSERT INTO tags(id, name, parent_id, path, depth, sort_order)
         VALUES(4,'新页',1,'地点轴/新页',2,0)",
        [],
    )
    .unwrap();
    c.execute(
        "INSERT INTO tag_links(tag_id, target_type, target_id, remark) VALUES(4,'note',503,'')",
        [],
    )
    .unwrap();
    // 回填前新表里确实没有它们
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE id=503"), 0);

    run(&c).unwrap();

    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NULL AND meta='漂移笔记'"),
        1,
        "漂移笔记必须回填,否则丢用户数据"
    );
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM entities WHERE path='地点轴/新页'"),
        1,
        "漂移标签必须回填"
    );
    assert_eq!(
        count(
            &c,
            "SELECT COUNT(*) FROM edges e JOIN entities s ON s.id = e.source_id \
             JOIN entities t ON t.id = e.target_id \
             WHERE e.kind='link' AND s.meta='漂移笔记' AND t.path='地点轴/新页'"
        ),
        1,
        "漂移链接必须回填成 link 边"
    );
    assert_eq!(
        count(
            &c,
            "SELECT COUNT(*) FROM entities_fts \
             WHERE rowid = (SELECT id FROM entities WHERE meta='漂移笔记')"
        ),
        1
    );
    assert_legacy_gone(&c);
}

/// ③ 续跑:v24 / v25 / v26 三个中间态各用 `run` 一次跑完到 27 不报错。
#[test]
fn run_from_v24_v25_v26_reaches_v27() {
    let v25 = at_v24();
    apply(&v25, MIGRATIONS[24], 25).unwrap();
    let v26 = migrated_to_v26();
    for c in [at_v24(), v25, v26] {
        run(&c).unwrap();
        assert_eq!(count(&c, "PRAGMA user_version"), latest_version());
        assert_legacy_gone(&c);
        assert_eq!(fk_violations(&c), 0);
    }
}

/// ④ 重放幂等:27 的库再跑一次 `run` 不改任何东西。
#[test]
fn v27_replay_is_a_noop() {
    let c = migrated_to_v26();
    run(&c).unwrap();
    let snap = || {
        (
            count(&c, "SELECT COUNT(*) FROM entities"),
            count(&c, "SELECT COUNT(*) FROM edges"),
            count(&c, "SELECT COUNT(*) FROM entities_fts"),
            count(&c, "PRAGMA user_version"),
        )
    };
    let first = snap();
    run(&c).unwrap();
    assert_eq!(snap(), first);
}

/// 真库副本就地迁移验收(默认跳过):验证漂移回填与下架。
/// `LIFELOG_MIGRATE_DB=<副本> cargo test --lib migrate_real_db_copy -- --ignored --nocapture`
#[test]
#[ignore = "需 LIFELOG_MIGRATE_DB 指向真库副本(会就地迁移)"]
fn migrate_real_db_copy() {
    let path = std::env::var("LIFELOG_MIGRATE_DB").expect("未设 LIFELOG_MIGRATE_DB");
    let c = Connection::open(&path).unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    let notes = count(&c, "SELECT COUNT(*) FROM notes");
    let tags = count(&c, "SELECT COUNT(*) FROM tags");
    run(&c).unwrap();
    assert_eq!(count(&c, "PRAGMA user_version"), 27);
    assert_legacy_gone(&c);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE kind='note'"), notes, "漂移笔记必须回填");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE kind='tag'"), tags, "漂移标签必须回填");
    println!(
        "真库副本迁移后: entities={} edges={} entities_fts={} notes={} tags={}",
        count(&c, "SELECT COUNT(*) FROM entities"),
        count(&c, "SELECT COUNT(*) FROM edges"),
        count(&c, "SELECT COUNT(*) FROM entities_fts"),
        notes,
        tags,
    );
}
