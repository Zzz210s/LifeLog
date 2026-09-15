//! 迁移 009:FTS 的 tags 列只收时间子树之外的标签(时间由日期筛选负责,不靠关键词)。
//! ①从 007 状态升级(008 回填把时间标签写进了索引串)后索引串必须被清洗
//! ②迁移后的触发器与 tags_tree::refresh_fts 口径一致(写入路径同样干净)
//! ③关键词 `2026`/`03` 不再因时间标签命中,普通标签仍可搜到
//! ④幂等:重复执行结果不变
use super::{latest_version, run, MIGRATIONS};
use crate::db::repos::notes::notes_filter::*;
use crate::db::repos::notes::query;
use rusqlite::Connection;

/// 009 之前的旧库(007 已应用);每次迁移后推进 user_version,与 migrate::run 一致
fn db_at_007() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    for (i, sql) in MIGRATIONS.iter().enumerate().take(7) {
        conn.execute_batch(sql).unwrap();
        conn.pragma_update(None, "user_version", (i + 1) as i64).unwrap();
    }
    conn
}

/// 旧库数据:一条历史笔记 + 一个普通标签(此时触发器已把标签写进索引)
fn seed_old_db(conn: &Connection) -> i64 {
    conn.execute_batch(
        "INSERT INTO notes(content, created_at, updated_at)
           VALUES('历史笔记', '2026-03-04 10:00:00', '2026-03-04 10:00:00');
         INSERT INTO tags(name, path, depth) VALUES('甲', '甲', 1);
         INSERT INTO tag_links(tag_id, target_type, target_id)
           VALUES((SELECT id FROM tags WHERE path='甲'), 'note', 1);",
    )
    .unwrap();
    1
}

fn fts_tags(conn: &Connection, id: i64) -> String {
    conn.query_row("SELECT tags FROM notes_fts WHERE rowid=?1", [id], |r| r.get(0))
        .unwrap()
}

fn hits(conn: &Connection, keyword: &str) -> usize {
    query(conn, &FilterConditions { keyword: Some(keyword.into()), ..empty() }, 0)
        .unwrap()
        .len()
}

#[test]
fn migration_009_cleans_time_tags_from_fts_but_keeps_plain_tags() {
    let conn = db_at_007();
    let id = seed_old_db(&conn);
    assert_eq!(fts_tags(&conn, id), "甲", "007 状态下的索引串");

    run(&conn).unwrap(); // 008(回填时间标签)+ 009(清洗 tags 列)

    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(version, latest_version());
    let tags = fts_tags(&conn, id);
    assert!(tags.contains('甲'), "普通标签必须留在索引里:{tags}");
    assert!(!tags.contains("时间排序"), "时间标签不得进 tags 列:{tags}");
    // 日期与排序不受影响:时间标签仍在库里
    let notes = query(&conn, &empty(), 0).unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].date.as_deref(), Some("2026-03-04"));
    assert!(notes[0].date_tag_id.is_some());
    // 关键词:`2026`(>=3 字符走 FTS)与 `03`(2 字符走 LIKE)都不再因时间标签命中
    assert_eq!(hits(&conn, "2026"), 0, "时间标签不得污染关键词搜索");
    assert_eq!(hits(&conn, "03"), 0);
    assert_eq!(hits(&conn, "历史笔记"), 1);
    assert_eq!(hits(&conn, "甲"), 1, "普通标签仍可搜到");
}

#[test]
fn migration_009_triggers_and_refresh_fts_agree() {
    let mut conn = db_at_007();
    run(&conn).unwrap();
    let id = crate::db::repos::notes::create(&mut conn, "新笔记 #乙").unwrap().id;
    let created = fts_tags(&conn, id);
    assert!(created.contains('乙') && !created.contains("时间排序"), "{created}");
    // 正文更新触发器(notes_au)
    conn.execute("UPDATE notes SET content='改过的正文' WHERE id=?1", [id]).unwrap();
    let updated = fts_tags(&conn, id);
    assert!(updated.contains('乙') && !updated.contains("时间排序"), "{updated}");
    // 结构变更路径(tags_tree::refresh_fts)口径必须一致
    conn.execute("DELETE FROM notes_fts WHERE rowid=?1", [id]).unwrap();
    crate::db::repos::tags_tree::refresh_fts(&conn, &[id]).unwrap();
    assert_eq!(fts_tags(&conn, id), updated, "两条写入路径的索引串必须一致");
}

#[test]
fn migration_009_is_idempotent() {
    let conn = db_at_007();
    let id = seed_old_db(&conn);
    run(&conn).unwrap();
    let once = fts_tags(&conn, id);
    // 直接重放 009 的 SQL(DELETE 起手整体重建),再跑一次迁移序列
    conn.execute_batch(MIGRATIONS[8]).unwrap();
    assert_eq!(fts_tags(&conn, id), once);
    run(&conn).unwrap();
    assert_eq!(fts_tags(&conn, id), once);
}
