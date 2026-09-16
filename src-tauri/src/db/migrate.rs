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
];

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
        let fk_off = FK_OFF_VERSIONS.contains(&v);
        if fk_off {
            conn.pragma_update(None, "foreign_keys", "OFF")?;
        }
        let applied = apply(conn, sql, v);
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
#[path = "migration_atomicity_tests.rs"]
mod migration_atomicity_tests;

#[cfg(test)]
#[path = "time_tag_migration_tests.rs"]
mod time_tag_migration_tests;

#[cfg(test)]
#[path = "migrate_tests.rs"]
mod migrate_tests;

#[cfg(test)]
#[path = "fts_time_tag_migration_tests.rs"]
mod fts_time_tag_migration_tests;
