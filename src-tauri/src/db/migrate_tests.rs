//! 迁移序列的基础回归(自 migrate.rs 拆出以守 200 行上限):
//! 建表 / 版本号推进 / 幂等 / 003 的 FTS 与 004 的回填。
use super::*;

fn db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    run(&conn).unwrap();
    conn
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn migrations_create_tables_and_bump_version() {
    let conn = db();
    assert_eq!(count(&conn, "PRAGMA user_version"), latest_version());
    for table in ["settings", "tags", "tag_links", "notes", "saved_views"] {
        let n = count(
            &conn,
            &format!("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='{table}'"),
        );
        assert_eq!(n, 1, "table missing: {table}");
    }
}

#[test]
fn migrations_are_idempotent() {
    let conn = db();
    run(&conn).unwrap(); // 第二次应为 no-op 不报错
    assert_eq!(count(&conn, "PRAGMA user_version"), latest_version());
}

#[test]
fn migration_003_drops_diary_and_adds_fts() {
    let conn = Connection::open_in_memory().unwrap();
    run(&conn).unwrap();
    // v2 信息流:diary 表移除
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM sqlite_master WHERE name='diary_entries'"), 0);
    // FTS 虚表与五个同步触发器齐备
    for name in [
        "notes_fts",
        "notes_ai",
        "notes_ad",
        "notes_au",
        "tag_links_ai",
        "tag_links_ad",
    ] {
        assert_eq!(
            count(&conn, &format!("SELECT COUNT(*) FROM sqlite_master WHERE name='{name}'")),
            1,
            "missing: {name}"
        );
    }
    // 三条中文笔记入索引(触发器自动同步)
    let mut conn = conn;
    for text in ["今天心情很好", "天气不错", "看完了 #电影 神作"] {
        crate::db::repos::notes::create(&mut conn, text).unwrap();
    }
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM notes_fts"), 3);
}

/// 升级路径:旧库(阶段 4 前)已有笔记,迁移必须回填 FTS 行,否则 >=3 字符关键词
/// 走 FTS 分支永久搜不到;触发器只覆盖迁移之后的新增/变更,不覆盖历史数据。
#[test]
fn migration_backfills_fts_for_preexisting_notes() {
    use crate::db::repos::notes::{notes_filter::*, query};
    let conn = Connection::open_in_memory().unwrap();
    // 仅应用 001/002 并把 user_version 停在 2:模拟阶段 4 之前的库
    conn.execute_batch(MIGRATIONS[0]).unwrap();
    conn.execute_batch(MIGRATIONS[1]).unwrap();
    conn.pragma_update(None, "user_version", 2i64).unwrap();
    conn.execute_batch(
        "INSERT INTO notes(content) VALUES('买牛奶');
         INSERT INTO tags(name) VALUES('验收标签');
         INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(1, 'diary', 1);",
    )
    .unwrap();

    run(&conn).unwrap();

    // 回填后索引行数与笔记行数一致(触发器在场不等于历史数据已索引)
    let notes = count(&conn, "SELECT COUNT(*) FROM notes");
    let fts = count(&conn, "SELECT COUNT(*) FROM notes_fts");
    assert_eq!(fts, notes, "notes_fts 未回填历史笔记");
    // 3 字符中文关键词走 FTS 分支,迁移前的笔记必须命中
    let hit = query(
        &conn,
        &FilterConditions { keyword: Some("买牛奶".into()), ..empty() },
        0,
    )
    .unwrap();
    assert_eq!(hit.len(), 1, "迁移前的笔记应可被 FTS 分支搜到");
    assert_eq!(hit[0].content, "买牛奶");
    // 004:v1 残留的 diary 链接与仅被它引用的孤儿 tag 清理掉
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM tag_links WHERE target_type <> 'note'"), 0);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM tags WHERE name='验收标签'"), 0, "孤儿 tag 应清理");
}
