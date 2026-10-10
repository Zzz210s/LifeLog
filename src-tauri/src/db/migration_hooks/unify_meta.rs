//! 028 的事务内前置钩子(在 `migrate::apply` 的同一事务里、迁移 SQL **之前**跑,
//! 见 spec §7.1 步 2/7):产出迁移 SQL 要读的 `_id_map`,并把 settings 里存 id 的键改写到新 id。
//!
//! 与 027 的 `entity_ids::rewrite_graph_positions`(事务外、必须幂等)不同:本模块的钩子与 028 的
//! SQL 同事务,失败一起回滚,`_id_map`(临时表)不会残留,故按「跑一次」写、不带幂等守卫。
//! `entity_ids.rs` 仍保留(老库升级链的 027 历史),两者互不影响。
use rusqlite::{Connection, OptionalExtension};
use serde_json::{Map, Value};

use crate::db::repos::notes::{notes_filter_groups::normalize_groups, FilterConditions};
use crate::db::repos::settings::{self, FILTER_CURRENT_KEY, GRAPH_POSITIONS_KEY};

/// 028 的版本号(与 `MIGRATIONS` 追加 028 后的下标 +1 成对,见 `migrate.rs`)。
/// Task 1.1 只登记钩子,不追加 028 —— 空 SQL 会把 `latest_version()` 顶到 28、打红既有用例。
pub(crate) const UNIFY_META_VERSION: i64 = 28;

/// `ui.mru.notes` 的键名(真源在前端 `src/main-window/palette/palette-settings.ts`;
/// 值是 JSON 数组 `[{id,count}]`,`id` 是笔记 id 的**字符串**)。
pub(crate) const MRU_NOTES_KEY: &str = "ui.mru.notes";

/// 028 预置的默认筛选(spec §4.1 / P0-4):`op='or'` 的条件组两项 —— `treeMembership=out` 与
/// `singleLine=multi`,等价于 `NOT (在树内 AND 单行)`,即今天「全部笔记」的结果集。
/// 逐字段照 [`crate::db::repos::notes::FilterConditions`] 的序列化顺序写死,让应用后续「原样再存」
/// 不产生 diff;`treeMembership` / `singleLine` 的解析要等 Task 2.3,迁移只负责落这段 JSON。
const DEFAULT_FILTER_JSON: &str = concat!(
    r#"{"keyword":null,"tags":[],"excludeTags":[],"relations":[],"excludeRelations":[],"#,
    r#""tagPresence":null,"sort":null,"sorts":[],"groupBy":null,"expr":null,"groupOp":"and","#,
    r#""groups":[{"op":"or","items":[{"kind":"treeMembership","value":"out"},"#,
    r#"{"kind":"singleLine","value":"multi"}]}]}"#,
);

/// 建临时表 `_id_map(old_id, new_id)`:笔记在前(按旧 id 升序)发 1..k,标签在后(按旧 id 升序)
/// 接着发。028 的 SQL 与 [`rewrite_settings_ids`] 都从它取数;`DROP ... IF EXISTS` 让钩子重放
/// 不炸(同一事务内理论上只跑一次)。
pub(crate) fn build_id_map(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "DROP TABLE IF EXISTS _id_map;
         CREATE TEMP TABLE _id_map AS
           SELECT id AS old_id,
                  ROW_NUMBER() OVER (ORDER BY (kind = 'tag'), id) AS new_id
           FROM entities;
         CREATE UNIQUE INDEX _id_map_old ON _id_map(old_id);",
    )
}

/// 单条旧 id -> 新 id 的查表(查不到 = 该实体已删,调用方丢弃该键/id)。
fn new_id_of(conn: &Connection, old_id: i64) -> rusqlite::Result<Option<i64>> {
    conn.query_row("SELECT new_id FROM _id_map WHERE old_id = ?1", [old_id], |r| r.get(0))
        .optional()
}

/// 按 `_id_map` 改写 settings 里存 id 的键:`graph_positions`(键是 id 字符串)与
/// `ui.mru.notes`(值的 `id` 字段)。不可映射的键/id 丢弃(`id` 已删的残留),坏 JSON 跳过不动。
/// 存路径的键(`ui.mru.tags` / `time_tag_template`)与筛选条件原样保留。
pub(crate) fn rewrite_settings_ids(conn: &Connection) -> rusqlite::Result<()> {
    rewrite_graph_positions(conn)?;
    rewrite_mru_notes(conn)
}

/// `graph_positions` 的键改写成新 id;键不存在 / 坏 JSON 一律跳过(不删设置)。
fn rewrite_graph_positions(conn: &Connection) -> rusqlite::Result<()> {
    let Some(raw) = settings::get(conn, GRAPH_POSITIONS_KEY)? else {
        return Ok(());
    };
    let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&raw) else {
        eprintln!("迁移 028:graph_positions 不是 JSON 对象,跳过键改写(节点回到初始位置)");
        return Ok(());
    };
    let (mut moved, mut dropped) = (0usize, 0usize);
    let mut out = Map::new();
    for (key, value) in map {
        let Ok(id) = key.parse::<i64>() else {
            dropped += 1;
            continue;
        };
        match new_id_of(conn, id)? {
            Some(new_id) => {
                out.insert(new_id.to_string(), value);
                moved += 1;
            }
            None => dropped += 1,
        }
    }
    if dropped > 0 {
        eprintln!("迁移 028:graph_positions 丢弃 {dropped} 个无法映射的键(节点回到初始位置)");
    }
    let json = serde_json::to_string(&Value::Object(out))
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    settings::set(conn, GRAPH_POSITIONS_KEY, &json)?;
    eprintln!("迁移 028:graph_positions 键改写 {moved} 个(丢弃 {dropped})");
    Ok(())
}

/// `ui.mru.notes` 的每条 `id` 改写;不可映射的条目与缺 id 的条目丢弃,其余字段原样保留。
fn rewrite_mru_notes(conn: &Connection) -> rusqlite::Result<()> {
    let Some(raw) = settings::get(conn, MRU_NOTES_KEY)? else {
        return Ok(());
    };
    let Ok(Value::Array(items)) = serde_json::from_str::<Value>(&raw) else {
        eprintln!("迁移 028:ui.mru.notes 不是 JSON 数组,跳过改写");
        return Ok(());
    };
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let Value::Object(mut obj) = item else { continue };
        let id = obj.get("id").and_then(Value::as_str).and_then(|s| s.parse::<i64>().ok());
        let Some(id) = id else { continue };
        if let Some(new_id) = new_id_of(conn, id)? {
            obj.insert("id".into(), Value::String(new_id.to_string()));
            out.push(Value::Object(obj));
        }
    }
    let json = serde_json::to_string(&Value::Array(out))
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    settings::set(conn, MRU_NOTES_KEY, &json)
}

/// `filter_current` 是否已有**有效条件**(归一后 `groups` 非空)。缺失 / 空串 / 坏 JSON /
/// 只有空组的(真库现状 `{"groupOp":"and","groups":[],"sort":"newest",...}`)都算「为空」——
/// 应用本来就把这些退化态当「全部实体」,迁移要给它们预置今天「全部笔记」的默认筛选。
/// 归一(而非看字符串长短)才能把旧平铺字段也搬进 `groups` 一并判断。
fn has_effective_conditions(raw: &str) -> bool {
    match serde_json::from_str::<FilterConditions>(raw) {
        Ok(mut c) => {
            normalize_groups(&mut c);
            !c.groups.is_empty()
        }
        Err(_) => false,
    }
}

/// `filter_current` 没有有效条件时预置 [`DEFAULT_FILTER_JSON`];已有有效条件不动(用户条件优先)。
pub(crate) fn ensure_default_filter(conn: &Connection) -> rusqlite::Result<()> {
    if let Some(raw) = settings::get(conn, FILTER_CURRENT_KEY)? {
        if !raw.trim().is_empty() && has_effective_conditions(&raw) {
            return Ok(());
        }
    }
    settings::set(conn, FILTER_CURRENT_KEY, DEFAULT_FILTER_JSON)?;
    eprintln!("迁移 028:把当前筛选预置为「排除树内单行实体」(可在筛选栏编辑或清空)");
    Ok(())
}

/// 029 的版本号(与 `MIGRATIONS` 追加 029 后的下标 +1 成对,见 `migrate.rs`)。
pub(crate) const ENTITIES_FTS_VERSION: i64 = 29;

/// 030 的版本号(与 `MIGRATIONS` 追加 030 后的下标 +1 成对)。
pub(crate) const FTS_CLOSURE_VERSION: i64 = 30;

/// 029 的事务内前置钩子:把聚合唯一真源
/// [`ENTITIES_AGG`](crate::db::repos::entities::fts::ENTITIES_AGG) 拼成视图
/// `entities_fts_src(id, meta, paths)`。v30 复用同一钩子重建视图(常量 030 加了子孙 / 关系两段)。
///
/// 视图是**迁移时快照**:029.sql 的 9 个触发器与回填只引用它,故 `029.sql` / `030.sql` 里不出现
/// 任何聚合文本(`entities_fts_migration_tests::migration_029_has_no_aggregate_sql` /
/// `migration_030_has_no_aggregate_sql` 钉住)。改了常量就必须同时出新迁移重建视图,否则守卫用例
/// (`entities_fts_migration_tests::entities_fts_src_view_matches_rust_truth`)会指出视图已过期。
pub(crate) fn create_entities_fts_src_view(conn: &Connection) -> rusqlite::Result<()> {
    use crate::db::repos::entities::fts::ENTITIES_AGG;
    conn.execute_batch(&format!(
        "DROP VIEW IF EXISTS entities_fts_src;
         CREATE VIEW entities_fts_src(id, meta, paths) AS
         SELECT e.id, e.meta, {ENTITIES_AGG} FROM entities e;"
    ))
}
