//! 迁移序列的基础回归(自 migrate.rs 拆出以守 200 行上限):
//! 建表 / 版本号推进 / 幂等 / FTS 收口 / 老库升级路径。阶段 4 起终态只有
//! `entities` / `edges` / `entities_fts`(`notes` / `tags` / `notes_fts` 已随 027 下架)。
use super::*;

fn db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    run(&conn).unwrap();
    conn
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// 把库停在 `n` 版(手工重放前 n 条迁移)
fn at_version(n: usize) -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    for (i, sql) in MIGRATIONS.iter().enumerate().take(n) {
        apply(&conn, sql, (i + 1) as i64).unwrap();
    }
    conn
}

#[test]
fn migrations_create_tables_and_bump_version() {
    let conn = db();
    assert_eq!(count(&conn, "PRAGMA user_version"), latest_version());
    for table in ["settings", "points", "lines"] {
        let n = count(
            &conn,
            &format!("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='{table}'"),
        );
        assert_eq!(n, 1, "table missing: {table}");
    }
    // 027 后老表一个不留
    for gone in ["notes", "tags", "tag_links", "note_links", "tag_aliases", "tag_merge_log", "entities", "edges", "entities_fts"] {
        let n = count(
            &conn,
            &format!("SELECT COUNT(*) FROM sqlite_master WHERE name='{gone}'"),
        );
        assert_eq!(n, 0, "老对象应已下架: {gone}");
    }
    // 视图模块已在 014 删除(S6)
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM sqlite_master WHERE name='saved_views'"),
        0,
        "saved_views 应已被迁移 014 删除"
    );
}

#[test]
fn migrations_are_idempotent() {
    let conn = db();
    run(&conn).unwrap(); // 第二次应为 no-op 不报错
    assert_eq!(count(&conn, "PRAGMA user_version"), latest_version());
}


/// 升级路径:旧库已有笔记,迁移必须回填 FTS 行,否则 >=3 字符关键词走 FTS 分支永久搜不到。
#[test]
fn migration_backfills_fts_for_preexisting_notes() {
    use crate::db::repos::notes::{notes_filter::*, query};
    // 仅应用 001/002 并把 user_version 停在 2:模拟老库
    let conn = at_version(2);
    conn.execute_batch(
        "INSERT INTO notes(content) VALUES('买牛奶');
         INSERT INTO tags(name) VALUES('验收标签');
         INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(1, 'diary', 1);",
    )
    .unwrap();

    run(&conn).unwrap();

    // 回填后索引行数与实体数一致(触发器在场不等于历史数据已索引;029 起一行一实体)
    let points = count(&conn, "SELECT COUNT(*) FROM points WHERE id <> 0");
    let fts = count(&conn, "SELECT COUNT(*) FROM points_fts WHERE meta <> ''");
    assert_eq!(fts, points, "points_fts 未回填历史点(保留点不进索引)");
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM points_fts \
             WHERE rowid = (SELECT id FROM points WHERE meta='买牛奶')"
        ),
        1,
        "历史笔记自己必须有索引行"
    );
    // 3 字符中文关键词走 FTS 分支,迁移前的笔记必须命中
    let hit = query(
        &conn,
        &FilterConditions { keyword: Some("买牛奶".into()), ..empty() },
        0,
    )
    .unwrap();
    assert_eq!(hit.len(), 1, "迁移前的笔记应可被 FTS 分支搜到");
    assert_eq!(hit[0].content, "买牛奶");
    // 004:v1 残留的 diary 链接与仅被它引用的孤儿 tag 清理掉 —— 统一实体后引用边一律 link
    // (008 会给笔记回填时间标签,故 link 边不为 0);`link` 边只许指向树内实体
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM lines e JOIN points t ON t.id = e.to_id \
             WHERE (e.name_id IS NULL OR e.name_id <> 0) AND t.path IS NULL"
        ),
        0,
        "引用边不得指向树外实体(diary 链接不得成活)"
    );
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM points WHERE path='验收标签'"),
        0,
        "孤儿 tag 应清理"
    );
}

/// 别名表终态叫 `entity_aliases`,外键 ON(CASCADE 依赖它),且无数据回填
#[test]
fn migration_015_alias_table_renamed_and_fk_on() {
    let conn = db();
    assert_eq!(count(&conn, "PRAGMA user_version"), latest_version());
    assert_eq!(count(&conn, "PRAGMA foreign_keys"), 1, "CASCADE 依赖外键开关");
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM sqlite_master WHERE name='entity_aliases'"), 1);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM entity_aliases"), 0, "别名从零开始");
}

/// v14 旧库升到终态:存量标签/笔记搬进实体,重跑 no-op
#[test]
fn migration_015_upgrades_v14_and_is_idempotent() {
    let conn = at_version(14);
    conn.execute_batch(
        "INSERT INTO tags(name, path, depth) VALUES('甲', '甲', 1);
         INSERT INTO notes(content) VALUES('存量笔记');
         INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(1, 'note', 1);",
    )
    .unwrap();

    run(&conn).unwrap();

    assert_eq!(count(&conn, "SELECT COUNT(*) FROM points WHERE path IS NOT NULL"), 1);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM points WHERE path IS NULL AND id <> 0"), 1);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM lines WHERE (name_id IS NULL OR name_id <> 0)"), 1);
    let snap = || (count(&conn, "PRAGMA user_version"), count(&conn, "SELECT COUNT(*) FROM points"));
    let first = snap();
    run(&conn).unwrap(); // 版本闸门:第二次 no-op
    assert_eq!(snap(), first);
}

/// 别名 CASCADE:删目标标签实体连带清掉它的别名,别的标签的别名不受影响
#[test]
fn deleting_target_tag_cascades_aliases() {
    let conn = db();
    conn.execute_batch(
        "INSERT INTO points(id, meta, created_at, path, depth)
           VALUES(1000000001,'甲','2026-01-01','甲',1),
                 (1000000002,'乙','2026-01-01','乙',1);
         INSERT INTO entity_aliases(alias, entity_id)
           VALUES('旧甲', 1000000001), ('甲甲', 1000000001), ('旧乙', 1000000002);",
    )
    .unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM entity_aliases"), 3);
    conn.execute("DELETE FROM points WHERE id = 1000000001", []).unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM entity_aliases"), 1, "只清目标标签的别名");
    assert_eq!(count(&conn, "SELECT entity_id FROM entity_aliases"), 1000000002, "幸存别名仍指向乙");
}
