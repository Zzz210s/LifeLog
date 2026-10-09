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
    for table in ["settings", "entities", "edges"] {
        let n = count(
            &conn,
            &format!("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='{table}'"),
        );
        assert_eq!(n, 1, "table missing: {table}");
    }
    // 027 后老表一个不留
    for gone in ["notes", "tags", "tag_links", "note_links", "tag_aliases", "tag_merge_log"] {
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

#[test]
fn final_schema_has_entities_fts_and_nine_triggers() {
    let conn = Connection::open_in_memory().unwrap();
    run(&conn).unwrap();
    // v2 信息流:diary 表移除
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM sqlite_master WHERE name='diary_entries'"), 0);
    // 老 FTS 与老触发器全下架
    for gone in ["notes_fts", "notes_ai", "notes_ad", "notes_au", "tag_links_ai", "tag_links_ad",
                 "tag_aliases_ai", "tag_aliases_au", "tag_aliases_ad"] {
        assert_eq!(
            count(&conn, &format!("SELECT COUNT(*) FROM sqlite_master WHERE name='{gone}'")),
            0,
            "老对象应已下架: {gone}"
        );
    }
    // 新 9 个触发器齐备(8 个 026 + 027 重建;entities_fts 覆盖实体)
    for name in [
        "entities_ai", "entities_ad", "entities_au", "edges_ai", "edges_ad", "edges_au",
        "entity_aliases_ai", "entity_aliases_au", "entity_aliases_ad",
    ] {
        assert_eq!(
            count(&conn, &format!("SELECT COUNT(*) FROM sqlite_master WHERE name='{name}'")),
            1,
            "missing: {name}"
        );
    }
    // 三条中文笔记入索引(触发器自动同步)
    for (i, text) in ["今天心情很好", "天气不错", "看完了 #电影 神作"].iter().enumerate() {
        conn.execute(
            "INSERT INTO entities(id, meta, created_at) VALUES(?1, ?2, '2026-01-01T00:00:00.000')",
            rusqlite::params![i as i64 + 1, text],
        )
        .unwrap();
    }
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM entities_fts WHERE meta <> ''"), 3);
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

    // 回填后索引行数与笔记实体数一致(触发器在场不等于历史数据已索引)
    let notes = count(&conn, "SELECT COUNT(*) FROM entities WHERE kind = 'note'");
    let fts = count(&conn, "SELECT COUNT(*) FROM entities_fts WHERE content <> ''");
    assert_eq!(fts, notes, "entities_fts 未回填历史笔记");
    // 3 字符中文关键词走 FTS 分支,迁移前的笔记必须命中
    let hit = query(
        &conn,
        &FilterConditions { keyword: Some("买牛奶".into()), ..empty() },
        0,
    )
    .unwrap();
    assert_eq!(hit.len(), 1, "迁移前的笔记应可被 FTS 分支搜到");
    assert_eq!(hit[0].content, "买牛奶");
    // 004:v1 残留的 diary 链接与仅被它引用的孤儿 tag 清理掉 -> 不产生 relation 边
    // (008 会给笔记回填时间标签,故 tagging 边不为 0,只查 diary 类)
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM edges WHERE kind='relation'"), 0, "diary 链接不得变成 relation 边");
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM entities WHERE kind='tag' AND path='验收标签'"),
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

    assert_eq!(count(&conn, "SELECT COUNT(*) FROM entities WHERE kind='tag'"), 1);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM entities WHERE kind='note'"), 1);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM edges WHERE kind='tagging'"), 1);
    let snap = || (count(&conn, "PRAGMA user_version"), count(&conn, "SELECT COUNT(*) FROM entities"));
    let first = snap();
    run(&conn).unwrap(); // 版本闸门:第二次 no-op
    assert_eq!(snap(), first);
}

/// 别名 CASCADE:删目标标签实体连带清掉它的别名,别的标签的别名不受影响
#[test]
fn deleting_target_tag_cascades_aliases() {
    let conn = db();
    conn.execute_batch(
        "INSERT INTO entities(id, kind, name, content, created_at, path, depth)
           VALUES(1000000001,'tag','甲','','2026-01-01','甲',1),
                 (1000000002,'tag','乙','','2026-01-01','乙',1);
         INSERT INTO entity_aliases(alias, entity_id)
           VALUES('旧甲', 1000000001), ('甲甲', 1000000001), ('旧乙', 1000000002);",
    )
    .unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM entity_aliases"), 3);
    conn.execute("DELETE FROM entities WHERE id = 1000000001", []).unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM entity_aliases"), 1, "只清目标标签的别名");
    assert_eq!(count(&conn, "SELECT entity_id FROM entity_aliases"), 1000000002, "幸存别名仍指向乙");
}
