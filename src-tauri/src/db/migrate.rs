//! 迁移序列与前置钩子。
//! 钩子:008/013/014 的日志钩子在 `db::migration_hooks`(只读不改库);
//! 016 要把旧多页条件搬进单份条件,取值只能在 Rust 做,故它的钩子(`carry_over_filter_current`)在本文件,
//! 迁移体(`migrations/016_filter_current.sql`)只负责删旧键。
use rusqlite::Connection;

use super::migration_hooks;
use crate::db::repos::notes::FilterConditions;
use crate::db::repos::settings::{self, FILTER_CURRENT_KEY};

/// 迁移序列:数组顺序即版本号(1 起);新增迁移只能追加在末尾
const MIGRATIONS: &[&str] = &[
    include_str!("migrations/001_init.sql"),
    include_str!("migrations/002_diary.sql"),
    include_str!("migrations/003_stream.sql"),
    include_str!("migrations/004_stream_backfill.sql"),
    include_str!("migrations/005_rename_keys.sql"),
    include_str!("migrations/006_tag_tree.sql"),
    include_str!("migrations/007_saved_views.sql"),
    include_str!("migrations/008_time_tags.sql"),
    include_str!("migrations/009_fts_time_tags.sql"),
    include_str!("migrations/010_view_icon.sql"),
    include_str!("migrations/011_time_tag_demotion.sql"),
    include_str!("migrations/012_drop_note_updated_at.sql"),
    include_str!("migrations/013_drop_done_doing_tags.sql"),
    include_str!("migrations/014_drop_saved_views.sql"),
    include_str!("migrations/015_tag_aliases.sql"),
    include_str!("migrations/016_filter_current.sql"),
];

/// 012 的位次(1 起)与它删除的列名:SQLite 没有 `DROP COLUMN IF EXISTS`,
/// 重跑会报 no such column,故执行前按列存在性判定(见 notes_has_column)。
const DROP_UPDATED_AT_VERSION: i64 = 12;
const UPDATED_AT_COLUMN: &str = "updated_at";

/// notes 表当前是否还有该列(pragma_table_info 在表不存在时返回空)
fn notes_has_column(conn: &Connection, column: &str) -> rusqlite::Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name = ?1",
        [column],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

/// 016 之前把 tabs_state 的活动页条件搬进 filter_current
const FILTER_CURRENT_VERSION: i64 = 16;

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

/// 016 之前:沿用旧 tabs_state 当前活动页的条件(已存在 filter_current 时**不覆盖**);
/// 越界 / 缺 tabs / 坏 JSON 一律退化到默认空条件(与前端 parseTabsState 的兜底一致)。
/// 取值只能在 Rust 做(SQL 解析不了 JSON),迁移体只负责删旧键。
fn carry_over_filter_current(conn: &Connection) -> rusqlite::Result<()> {
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
            None => (FilterConditions::default(), "活动页越界或缺 conditions,退化为空条件"),
        },
        Err(_) => (FilterConditions::default(), "旧值不是合法 JSON,退化为空条件"),
    };
    let json = serde_json::to_string(&conds)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    settings::set(conn, FILTER_CURRENT_KEY, &json)?;
    eprintln!("迁移 016:当前筛选条件从 tabs_state 迁移({how})");
    Ok(())
}

/// 需要临时关闭外键约束的迁移:重建仍被 tag_links 引用的父表时,外键 ON 会让
/// DROP TABLE tags 沿 ON DELETE CASCADE 把 tag_links 数据级联删空。
/// PRAGMA foreign_keys 在事务内是 no-op,故必须在事务外关闭、提交后再打开。
const FK_OFF_VERSIONS: &[i64] = &[6];

/// 最新迁移版本号(= 迁移文件个数);供备份设施判断"是否有迁移要跑"
pub fn latest_version() -> i64 {
    MIGRATIONS.len() as i64
}

/// 单条迁移的执行边界:SQL 与 user_version 在同一事务内提交,失败整批回滚
fn apply(conn: &Connection, sql: &str, version: i64) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(sql)?;
    tx.pragma_update(None, "user_version", version)?;
    tx.commit()
}

/// 按 PRAGMA user_version 顺序执行未应用的迁移
pub fn run(conn: &Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate() {
        let v = (i + 1) as i64;
        if v <= current {
            continue;
        }
        if v == migration_hooks::TIME_TAG_VERSION {
            migration_hooks::warn_skipped_backfill(conn)?;
        }
        if v == migration_hooks::DROP_DONE_DOING_VERSION {
            migration_hooks::warn_drop_done_doing(conn)?;
        }
        if v == migration_hooks::DROP_SAVED_VIEWS_VERSION {
            migration_hooks::warn_drop_saved_views(conn)?;
        }
        if v == FILTER_CURRENT_VERSION {
            carry_over_filter_current(conn)?;
        }
        let fk_off = FK_OFF_VERSIONS.contains(&v);
        if fk_off {
            conn.pragma_update(None, "foreign_keys", "OFF")?;
        }
        // 012 幂等:列已不存在(重跑或已升级)时跳过 DROP COLUMN 语句,仍推进版本号
        let skip = v == DROP_UPDATED_AT_VERSION
            && !notes_has_column(conn, UPDATED_AT_COLUMN)?;
        let applied = apply(conn, if skip { "" } else { sql }, v);
        // 无论成败都恢复外键开关:连接随后会被业务复用,不能留在 OFF
        if fk_off {
            conn.pragma_update(None, "foreign_keys", "ON")?;
        }
        applied?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "rename_keys_tests.rs"]
mod rename_keys_tests;

#[cfg(test)]
#[path = "tag_tree_migration_tests.rs"]
mod tag_tree_migration_tests;

#[cfg(test)]
#[path = "views_migration_tests.rs"]
mod views_migration_tests;

#[cfg(test)]
#[path = "saved_views_removal_tests.rs"]
mod saved_views_removal_tests;

#[cfg(test)]
#[path = "migration_atomicity_tests.rs"]
mod migration_atomicity_tests;

#[cfg(test)]
#[path = "time_tag_migration_tests.rs"]
mod time_tag_migration_tests;

#[cfg(test)]
#[path = "drop_updated_at_tests.rs"]
mod drop_updated_at_tests;

#[cfg(test)]
#[path = "migrate_tests.rs"]
mod migrate_tests;

#[cfg(test)]
#[path = "filter_current_migration_tests.rs"]
mod filter_current_migration_tests;

#[cfg(test)]
#[path = "time_tag_demotion_tests.rs"]
mod time_tag_demotion_tests;

#[cfg(test)]
#[path = "done_doing_migration_tests.rs"]
mod done_doing_migration_tests;
