use rusqlite::Connection;

const MIGRATIONS: &[&str] = &[
    include_str!("migrations/001_init.sql"),
    include_str!("migrations/002_diary.sql"),
    include_str!("migrations/003_stream.sql"),
];

/// 按 PRAGMA user_version 顺序执行未应用的迁移
pub fn run(conn: &Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate() {
        let v = (i + 1) as i64;
        if v > current {
            let tx = conn.unchecked_transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", v)?;
            tx.commit()?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn migrations_create_tables_and_bump_version() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        let v: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, MIGRATIONS.len() as i64);
        for table in ["settings", "tags", "tag_links", "notes"] {
            let n: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 1, "table missing: {table}");
        }
    }

    #[test]
    fn migrations_are_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        run(&conn).unwrap(); // 第二次应为 no-op 不报错
    }

    #[test]
    fn migration_003_drops_diary_and_adds_fts() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        // v2 信息流:diary 表移除
        let diary: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name='diary_entries'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(diary, 0);
        // FTS 虚表与五个同步触发器齐备
        for name in [
            "notes_fts",
            "notes_ai",
            "notes_ad",
            "notes_au",
            "tag_links_ai",
            "tag_links_ad",
        ] {
            let n: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE name=?1",
                    [name],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 1, "missing: {name}");
        }
        // 三条中文笔记入索引(触发器自动同步)
        let mut conn = conn;
        for text in ["今天心情很好", "天气不错", "看完了 #电影 神作"] {
            crate::db::repos::notes::create(&mut conn, text).unwrap();
        }
        let fts: i64 = conn
            .query_row("SELECT COUNT(*) FROM notes_fts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fts, 3);
    }
}
