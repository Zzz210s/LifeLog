use crate::timetag;
use rusqlite::{params, Connection};

/// 自动时间标签开关(D4):缺失或非法值一律按开处理,只有显式 `false` 才是关
pub const AUTO_TIME_TAG_KEY: &str = "auto_time_tag";
/// 时间标签模板(D5):缺失或空串回退默认模板
pub const TIME_TAG_TEMPLATE_KEY: &str = "time_tag_template";
/// 当前筛选条件(S7):JSON 单份条件对象(与前端 `FilterConditions` / [`super::notes::FilterConditions`]
/// 同构);缺失/损坏时前端退化为「全部笔记」。键名真源在此 —— Rust 侧的标签改名/移动级联重写
/// (filter_rewrite)与前端 use-filter-state 共用它。
pub const FILTER_CURRENT_KEY: &str = "filter_current";
/// 关系图节点位置记忆(D1):JSON 对象,键是**标签实体 id**(字符串),值是该节点坐标。
/// 阶段 1 标签 id 偏移后由迁移 027 的钩子把老 id 键改写成实体 id 键(`entity_ids::rewrite_graph_positions`)。
pub const GRAPH_POSITIONS_KEY: &str = "graph_positions";
/// 保留名字点 `子级` 的 id 记录(spec §3.3):值是点 id 的十进制字符串,写入真源在迁移 031。
pub const TREE_LINE_NAME_ID_KEY: &str = "tree_line_name_id";

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

/// 读 `settings.tree_line_name_id`,带默认值:记录缺失 / 空串 / 非数字一律回退
/// [`reserved::TREE_NAME_ID`](crate::db::repos::entities::reserved::TREE_NAME_ID)。
/// 只兜底不修复库 —— 记录存在但悬空(指向不存在的点)时照样原样返回,由体检负责报错。
pub fn tree_line_name_id(conn: &Connection) -> rusqlite::Result<i64> {
    Ok(get(conn, TREE_LINE_NAME_ID_KEY)?
        .and_then(|v| v.trim().parse::<i64>().ok())
        .unwrap_or(crate::db::repos::entities::reserved::TREE_NAME_ID))
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
    fn tree_line_name_id_defaults_to_reserved_and_keeps_dangling_value() {
        let c = db();
        assert_eq!(tree_line_name_id(&c).unwrap(), 0, "缺失时回退保留点 id");
        set(&c, TREE_LINE_NAME_ID_KEY, "9x").unwrap();
        assert_eq!(tree_line_name_id(&c).unwrap(), 0, "非法值同样回退");
        set(&c, TREE_LINE_NAME_ID_KEY, "7").unwrap();
        assert_eq!(tree_line_name_id(&c).unwrap(), 7, "悬空 id 原样返回,交给体检报错");
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
