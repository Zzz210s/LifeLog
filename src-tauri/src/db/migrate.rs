use rusqlite::Connection;

const MIGRATIONS: &[&str] =
    &[include_str!("migrations/001_init.sql"), include_str!("migrations/002_diary.sql")];

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
    fn migration_002_creates_diary() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='diary_entries'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1);
    }
}
