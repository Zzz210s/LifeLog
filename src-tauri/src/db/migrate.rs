use rusqlite::Connection;

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

/// 008 回填时间标签:created_at 无法解析且尚无时间标签的笔记会被跳过。SQL 迁移里写不了日志,
/// 故在应用该迁移前先把被跳过的清单打到 stderr(迁移日志的一部分,见模块下方)。
const TIME_TAG_VERSION: i64 = 8;

/// 008 真正会跳过、且确实因此缺时间标签的笔记(id, created_at)。
/// 已有时间标签的笔记不在此列 —— 它们本来就不需要回填,报成"created_at 无法解析"是误导排障。
fn backfill_skips(conn: &Connection) -> rusqlite::Result<Vec<(i64, String)>> {
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
fn warn_skipped_backfill(conn: &Connection) -> rusqlite::Result<()> {
    for (id, created_at) in backfill_skips(conn)? {
        eprintln!(
            "迁移 008:笔记 {id} 的 created_at 无法解析且当前没有时间标签,跳过时间标签回填:{created_at}"
        );
    }
    Ok(())
}

/// 013 删除 done/doing 标签子树(S5):SQL 迁移里写不了日志,故在应用前把影响面打到 stderr
/// (与 008 的 warn_skipped_backfill 同一做法),给真实库升级留下可排障的读数。
const DROP_DONE_DOING_VERSION: i64 = 13;

/// done/doing 子树判定(与 013_drop_done_doing_tags.sql 逐字一致):根节点本身 + 其子孙
const DONE_DOING_PREDICATE: &str = "path = 'done' OR substr(path, 1, 5) = 'done/' \
     OR path = 'doing' OR substr(path, 1, 6) = 'doing/'";

/// 013 之前提示:将要删除的标签节点数、链接数与受影响笔记数(无命中则不打印)
fn warn_drop_done_doing(conn: &Connection) -> rusqlite::Result<()> {
    let sql = format!(
        "SELECT (SELECT COUNT(*) FROM tags WHERE {p}),
                (SELECT COUNT(*) FROM tag_links WHERE tag_id IN (SELECT id FROM tags WHERE {p})),
                (SELECT COUNT(DISTINCT target_id) FROM tag_links WHERE tag_id IN (SELECT id FROM tags WHERE {p}))",
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

/// 014 删除视图模块(S6):SQL 迁移里写不了日志,故在应用前把影响面打到 stderr
/// (与 008/013 的 warn 钩子同一做法),给真实库升级留下可排障的读数。
const DROP_SAVED_VIEWS_VERSION: i64 = 14;

/// 014 之前提示:存量自建视图数与被清掉的设置键(两者都没有则不打印)
fn warn_drop_saved_views(conn: &Connection) -> rusqlite::Result<()> {
    let views: i64 = conn
        .query_row("SELECT COUNT(*) FROM saved_views", [], |r| r.get(0))
        .unwrap_or(0);
    let legacy = crate::db::repos::settings::get(conn, "filter_last")?.is_some();
    if views > 0 || legacy {
        eprintln!(
            "迁移 014:删除视图模块 —— 自建视图 {views} 个,清理已被标签页取代的设置键 filter_last(状态改存 tabs_state)"
        );
    }
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
        if v == TIME_TAG_VERSION {
            warn_skipped_backfill(conn)?;
        }
        if v == DROP_DONE_DOING_VERSION {
            warn_drop_done_doing(conn)?;
        }
        if v == DROP_SAVED_VIEWS_VERSION {
            warn_drop_saved_views(conn)?;
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
#[path = "time_tag_demotion_tests.rs"]
mod time_tag_demotion_tests;

#[cfg(test)]
#[path = "done_doing_migration_tests.rs"]
mod done_doing_migration_tests;
