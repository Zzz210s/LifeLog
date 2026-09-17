use crate::timetag;
use rusqlite::{params, Connection};

/// 自动时间标签开关(D4):缺失或非法值一律按开处理,只有显式 `false` 才是关
pub const AUTO_TIME_TAG_KEY: &str = "auto_time_tag";
/// 时间标签模板(D5):缺失或空串回退默认模板
pub const TIME_TAG_TEMPLATE_KEY: &str = "time_tag_template";

/// 自动时间标签配置(设置页与创建路径共用一份读法)
#[derive(Debug, PartialEq)]
pub struct AutoTimeTag {
    pub enabled: bool,
    pub template: String,
}

/// 读取配置:开关缺失按开(与迁移 011 写入的默认值一致),模板缺失/空串回退默认
pub fn auto_time_tag(conn: &Connection) -> rusqlite::Result<AutoTimeTag> {
    let enabled = !matches!(get(conn, AUTO_TIME_TAG_KEY)?.as_deref(), Some("false"));
    let template = get(conn, TIME_TAG_TEMPLATE_KEY)?
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| timetag::DEFAULT_TEMPLATE.to_string());
    Ok(AutoTimeTag { enabled, template })
}

/// 新建笔记要写入的自动时间标签路径:开关关 -> None;模板非法 -> None 并记日志
/// (降级为不加标签,而不是拒绝保存笔记)
pub fn auto_time_path(conn: &Connection) -> rusqlite::Result<Option<String>> {
    let cfg = auto_time_tag(conn)?;
    if !cfg.enabled {
        return Ok(None);
    }
    let today = timetag::today_local(conn)?;
    match timetag::auto_time_path(&cfg.template, &today) {
        Some(path) => Ok(Some(path)),
        None => {
            eprintln!("自动时间标签已跳过:模板不是合法的标签路径({})", cfg.template);
            Ok(None)
        }
    }
}

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
