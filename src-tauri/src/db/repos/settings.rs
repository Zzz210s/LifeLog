use rusqlite::{params, Connection};

pub fn get(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    match rows.next()? {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}

pub fn set(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use rusqlite::Connection;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        migrate::run(&c).unwrap();
        c
    }

    #[test]
    fn get_missing_returns_none() {
        let c = db();
        assert_eq!(get(&c, "nope").unwrap(), None);
    }

    #[test]
    fn set_upserts() {
        let c = db();
        set(&c, "k", "1").unwrap();
        assert_eq!(get(&c, "k").unwrap().as_deref(), Some("1"));
        set(&c, "k", "2").unwrap();
        assert_eq!(get(&c, "k").unwrap().as_deref(), Some("2"));
    }
}
