//! 迁移前置钩子(自 migrate.rs 拆出以守单文件 200 行):SQL 迁移里写不了日志,
//! 这些函数在应用对应迁移**之前**把"接下来会动什么"打到 stderr,给真实库升级留可排障的读数。
//! 008/013/014 的钩子只读;016 的钩子**要改库**(把旧多页条件搬成单份),它是唯一一个写库的。
//! 调用点见 migrate.rs 的 `run`(版本号常量也在这里,与钩子成对)。
use rusqlite::Connection;

use crate::db::repos::notes::FilterConditions;
use crate::db::repos::settings::{self, FILTER_CURRENT_KEY};

/// 008 回填时间标签:created_at 无法解析且尚无时间标签的笔记会被跳过。
pub(crate) const TIME_TAG_VERSION: i64 = 8;

/// 008 真正会跳过、且确实因此缺时间标签的笔记(id, created_at)。
/// 已有时间标签的笔记不在此列 —— 它们本来就不需要回填,报成"created_at 无法解析"是误导排障。
pub(crate) fn backfill_skips(conn: &Connection) -> rusqlite::Result<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT n.id, n.created_at FROM notes n
         WHERE date(n.created_at) IS NULL
           AND NOT EXISTS (SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id
                           WHERE l.target_type = 'note' AND l.target_id = n.id
                             AND (t.path = '时间排序'
                                  OR substr(t.path, 1, length('时间排序') + 1) = '时间排序/'))
         ORDER BY n.id",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

/// 008 之前提示:列出既解析不出日期、又没有时间标签的笔记(它们拿不到时间标签)
pub(crate) fn warn_skipped_backfill(conn: &Connection) -> rusqlite::Result<()> {
    for (id, created_at) in backfill_skips(conn)? {
        eprintln!(
            "迁移 008:笔记 {id} 的 created_at 无法解析且当前没有时间标签,跳过时间标签回填:{created_at}"
        );
    }
    Ok(())
}

/// 013 删除 done/doing 标签子树(S5)
pub(crate) const DROP_DONE_DOING_VERSION: i64 = 13;

/// done/doing 子树判定(与 013_drop_done_doing_tags.sql 逐字一致):根节点本身 + 其子孙
const DONE_DOING_PREDICATE: &str = "path = 'done' OR substr(path, 1, 5) = 'done/' \
     OR path = 'doing' OR substr(path, 1, 6) = 'doing/'";

/// 013 之前提示:将要删除的标签节点数、链接数与受影响笔记数(无命中则不打印)。
/// 两个 tag_links 计数都显式限 `target_type = 'note'`:tag_links 现在也存 `'tag'` 携带行(R1),
/// 不过滤会把携带目标(标签 id)当成笔记计入"涉及 N 条笔记"。
pub(crate) fn warn_drop_done_doing(conn: &Connection) -> rusqlite::Result<()> {
    let sql = format!(
        "SELECT (SELECT COUNT(*) FROM tags WHERE {p}),
                (SELECT COUNT(*) FROM tag_links WHERE target_type = 'note' AND tag_id IN (SELECT id FROM tags WHERE {p})),
                (SELECT COUNT(DISTINCT target_id) FROM tag_links WHERE target_type = 'note' AND tag_id IN (SELECT id FROM tags WHERE {p}))",
        p = DONE_DOING_PREDICATE
    );
    let (tags, links, notes): (i64, i64, i64) =
        conn.query_row(&sql, [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    if tags > 0 || links > 0 {
        eprintln!(
            "迁移 013:删除 done/doing 标签子树 —— 标签 {tags} 个节点、链接 {links} 条,涉及 {notes} 条笔记(正文不动)"
        );
    }
    Ok(())
}

/// 014 删除视图模块(S6)
pub(crate) const DROP_SAVED_VIEWS_VERSION: i64 = 14;

/// 014 之前提示:存量自建视图数与被清掉的设置键(两者都没有则不打印)
pub(crate) fn warn_drop_saved_views(conn: &Connection) -> rusqlite::Result<()> {
    let views: i64 = conn
        .query_row("SELECT COUNT(*) FROM saved_views", [], |r| r.get(0))
        .unwrap_or(0);
    let legacy = crate::db::repos::settings::get(conn, "filter_last")?.is_some();
    if views > 0 || legacy {
        eprintln!(
            "迁移 014:删除视图模块 —— 自建视图 {views} 个,清理已被标签页取代的筛选条件设置键 filter_last"
        );
    }
    Ok(())
}

/// 016 之前把 tabs_state 的活动页条件搬进 filter_current
pub(crate) const FILTER_CURRENT_VERSION: i64 = 16;

/// 迁移 016 读的历史键(键名真源已迁到 settings::FILTER_CURRENT_KEY)
const LEGACY_TABS_STATE_KEY: &str = "tabs_state";

/// 迁移专用最小结构体:只关心 tabs[].conditions 与 activeIndex,不复用运行时结构
#[derive(serde::Deserialize)]
struct LegacyTabs {
    #[serde(default)]
    tabs: Vec<LegacyTab>,
    #[serde(default, rename = "activeIndex")]
    active_index: usize,
}

#[derive(serde::Deserialize)]
struct LegacyTab {
    #[serde(default)]
    conditions: Option<serde_json::Value>,
}

/// 016 之前:沿用旧 tabs_state 当前活动页的条件(已存在 filter_current 时**不覆盖**)。
/// 容错口径:**activeIndex 越界 → 取第一页**(与前端 `parseTabsState` 的夹取一致,那里 `idx` 非法也落回 0);
/// 活动页存在但没有 `conditions`(或越界且第一页也没有)→ 空条件;坏 JSON / 缺 tabs → 空条件。
/// 注:迁移体的 SQL 与 `user_version` 在同一事务里,但本钩子写在事务外(见 `run` 的调用顺序),
/// 失败时可能留下"filter_current 已写、tabs_state 未删、版本未推进"的中间态 —— 下次启动重跑即收敛
/// (新键已存在则不覆盖,旧键继续删),不会丢条件。
/// 取值只能在 Rust 做(SQL 解析不了 JSON),迁移体只负责删旧键。
pub(crate) fn carry_over_filter_current(conn: &Connection) -> rusqlite::Result<()> {
    let Some(raw) = settings::get(conn, LEGACY_TABS_STATE_KEY)? else {
        return Ok(()); // 没落过旧状态:无可迁移,也不创建 filter_current
    };
    if settings::get(conn, FILTER_CURRENT_KEY)?.is_some() {
        eprintln!("迁移 016:filter_current 已有值,不覆盖(旧键 tabs_state 仍会删除)");
        return Ok(());
    }
    let (conds, how) = match serde_json::from_str::<LegacyTabs>(&raw) {
        Ok(state) => match state.tabs.get(state.active_index).and_then(|t| t.conditions.clone()) {
            Some(v) => match serde_json::from_value::<FilterConditions>(v) {
                Ok(c) => (c, "沿用旧活动页条件"),
                Err(_) => (FilterConditions::default(), "旧条件对象无法解析,退化为空条件"),
            },
            // 越界(或活动页没有 conditions):取第一页 —— 与前端 parseTabsState 同口径,别把筛选丢掉
            None => match state.tabs.first().and_then(|t| t.conditions.clone()) {
                Some(v) => match serde_json::from_value::<FilterConditions>(v) {
                    Ok(c) => (c, "活动页越界,沿用第一页条件"),
                    Err(_) => (FilterConditions::default(), "第一页条件对象无法解析,退化为空条件"),
                },
                None => (FilterConditions::default(), "旧值里没有可用条目,退化为空条件"),
            },
        },
        Err(_) => (FilterConditions::default(), "旧值不是合法 JSON,退化为空条件"),
    };
    let json = serde_json::to_string(&conds)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    settings::set(conn, FILTER_CURRENT_KEY, &json)?;
    eprintln!("迁移 016:当前筛选条件从 tabs_state 迁移({how})");
    Ok(())
}

/// 021 新增 `tags.is_type`:SQLite 的 `ALTER TABLE ADD COLUMN` 没有 IF NOT EXISTS,
/// 迁移重放会报 duplicate column name,故在钩子里按列存在性决定是否 ADD COLUMN
/// (与 012 的跳过同理,但那里是 DROP、这里是 ADD,写不进纯 SQL)。
pub(crate) const TYPES_VERSION: i64 = 21;

/// 表是否存在(搬迁钩子按它决定空操作;pragma_table_info 对不存在的表返回空,但这里要取名字)
fn table_exists(conn: &Connection, name: &str) -> rusqlite::Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [name],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

/// 021 之前把 roles/tag_roles 搬进标签系统(搬迁优先于默默删表,与 013/014 的「动手前留读数」同一用意):
/// `roles.tag_id` 对应标签置 `is_type=1`;`tag_roles(tag_id, role_id)` 转成 tag_links 的
/// `'type'` 边 `(tag_id, 'type', roles.tag_id)`。两表都在 020 建,缺任一表(新库/重放)即空操作;
/// UPDATE 与 INSERT OR IGNORE 幂等,「钩子已跑、版本仍 20」的崩溃重放不会重复写。
pub(crate) fn carry_over_role_tables(conn: &Connection) -> rusqlite::Result<()> {
    if !table_exists(conn, "roles")? || !table_exists(conn, "tag_roles")? {
        return Ok(());
    }
    let roles: i64 = conn.query_row("SELECT COUNT(*) FROM roles", [], |r| r.get(0))?;
    let claims: i64 = conn.query_row("SELECT COUNT(*) FROM tag_roles", [], |r| r.get(0))?;
    if roles == 0 && claims == 0 {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch("UPDATE tags SET is_type = 1 WHERE id IN (SELECT tag_id FROM roles)")?;
    tx.execute_batch(
        "INSERT OR IGNORE INTO tag_links(tag_id, target_type, target_id)
         SELECT tr.tag_id, 'type', r.tag_id
         FROM tag_roles tr JOIN roles r ON r.id = tr.role_id",
    )?;
    tx.commit()?;
    eprintln!(
        "迁移 021:roles/tag_roles 搬进标签系统 —— 登记类型 {roles} 个、类型认领 {claims} 条(旧表随后删除)"
    );
    Ok(())
}

/// 确保 `tags.is_type` 存在且默认 0;重放时是空操作。
pub(crate) fn ensure_is_type_column(conn: &Connection) -> rusqlite::Result<()> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('tags') WHERE name = 'is_type'",
        [],
        |r| r.get(0),
    )?;
    if n == 0 {
        conn.execute_batch(
            "ALTER TABLE tags ADD COLUMN is_type INTEGER NOT NULL DEFAULT 0",
        )?;
    }
    Ok(())
}

/// 022 删除 `tags.is_type`(设计 2026-10-06 §2:「谁能当类型」这条约束取消,任何标签都能被指向)。
/// 与 021 的 ADD COLUMN 同理:SQLite 的 `ALTER TABLE ... DROP COLUMN` 没有 IF EXISTS,
/// 重放会报 no such column,故按列存在性决定是否执行。
/// 列上没有索引/触发器/生成列引用,`DROP COLUMN` 直接可用(不重建表、不触发 tag_links 级联)。
pub(crate) const RELATIONS_VERSION: i64 = 22;

pub(crate) fn drop_is_type_column(conn: &Connection) -> rusqlite::Result<()> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('tags') WHERE name = 'is_type'",
        [],
        |r| r.get(0),
    )?;
    if n > 0 {
        conn.execute_batch("ALTER TABLE tags DROP COLUMN is_type")?;
    }
    Ok(())
}
