//! 027 的迁移前钩子(spec §12 D1 的 `graph_positions` 改写,与 `entities.legacy_id` 下架)。
//!
//! 标签 id 在 024 整体偏移 `+TAG_ID_OFFSET`,而 `settings.graph_positions` 的键是**老标签 id**
//! (JSON 对象的数字字符串)。不改写的话图谱节点位置在阶段 4 后全部对不上(节点回到力导向初始位置)。
//! `ui.mru.notes` 存的是**笔记 id**(原值不动),`ui.mru.tags` 存的是路径 —— 两者都不需要改。
//!
//! 钩子必须**幂等**:它写在事务外(见 `migrate::run` 的调用顺序),崩溃后下次启动会重跑。
//! 故只对 `< TAG_ID_OFFSET` 的键偏移,已经是实体区间的键原样保留;解析失败的键丢弃。
//! `entities.legacy_id` 同理:SQLite 的 `ALTER TABLE ... DROP COLUMN` 没有 IF EXISTS。
use rusqlite::Connection;
use serde_json::{Map, Value};

use crate::db::repos::entities::TAG_ID_OFFSET;
use crate::db::repos::settings::{self, GRAPH_POSITIONS_KEY};

/// 027 的版本号(与 `MIGRATIONS` 的下标 +1 成对,见 `migrate.rs`)。
pub(crate) const ENTITY_IDS_VERSION: i64 = 27;

/// 下架 `entities.legacy_id`(阶段 4;列上没有索引/触发器/生成列引用,`DROP COLUMN` 直接可用)。
pub(crate) fn drop_legacy_id_column(conn: &Connection) -> rusqlite::Result<()> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('entities') WHERE name = 'legacy_id'",
        [],
        |r| r.get(0),
    )?;
    if n > 0 {
        conn.execute_batch("ALTER TABLE entities DROP COLUMN legacy_id")?;
    }
    Ok(())
}

/// 把 `graph_positions` 的键从老标签 id 改写成标签实体 id(`+ TAG_ID_OFFSET`)。
/// 键不存在/坏 JSON/坏对象一律跳过并打印,不改动设置;值原样搬运。
pub(crate) fn rewrite_graph_positions(conn: &Connection) -> rusqlite::Result<()> {
    let Some(raw) = settings::get(conn, GRAPH_POSITIONS_KEY)? else {
        return Ok(());
    };
    let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&raw) else {
        eprintln!("迁移 027:graph_positions 不是 JSON 对象,跳过键改写(节点回到初始位置)");
        return Ok(());
    };
    let (mut moved, mut kept, mut dropped) = (0usize, 0usize, 0usize);
    let mut out = Map::new();
    for (key, value) in map {
        match key.parse::<i64>() {
            // 老标签 id -> 标签实体 id(幂等:已偏移的直接保留)
            Ok(id) if id < TAG_ID_OFFSET => {
                out.insert((id + TAG_ID_OFFSET).to_string(), value);
                moved += 1;
            }
            Ok(_) => {
                out.insert(key, value);
                kept += 1;
            }
            Err(_) => dropped += 1,
        }
    }
    if dropped > 0 {
        eprintln!("迁移 027:graph_positions 丢弃 {dropped} 个无法解析的键(节点回到初始位置)");
    }
    if moved == 0 && kept > 0 && dropped == 0 {
        return Ok(()); // 已全在实体区间:重跑,不写库
    }
    let json = serde_json::to_string(&Value::Object(out))
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    settings::set(conn, GRAPH_POSITIONS_KEY, &json)?;
    eprintln!("迁移 027:graph_positions 键改写 {moved} 个(保留 {kept}、丢弃 {dropped})");
    Ok(())
}
