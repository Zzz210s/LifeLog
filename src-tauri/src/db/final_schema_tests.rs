//! 终态 schema 守卫(自 migrate_tests.rs 拆出,守 200 行上限):
//! v31 落地的 16 个触发器齐备、老 FTS / 老触发器 / 老表全部下架,且写入仍能被触发器同步。
use super::*;

/// 断言用:返回标量 COUNT 查询结果
fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn final_schema_has_points_fts_and_sixteen_triggers() {
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
    // v31 的 16 个触发器齐备:points / lines 各 3 + 别名 3 + 闭包刷新 7
    for name in [
        "points_ai", "points_ad", "points_au", "lines_ai", "lines_ad", "lines_au",
        "entity_aliases_ai", "entity_aliases_au", "entity_aliases_ad", "lines_fts_closure_ai",
        "lines_fts_closure_ad", "lines_fts_closure_au", "points_fts_closure_au",
        "entity_aliases_fts_closure_ai", "entity_aliases_fts_closure_au", "entity_aliases_fts_closure_ad",
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
            "INSERT INTO points(id, meta, created_at) VALUES(?1, ?2, '2026-01-01T00:00:00.000')",
            rusqlite::params![i as i64 + 1, text],
        )
        .unwrap();
    }
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM points_fts WHERE meta <> ''"), 3);
}