//! 迁移前置钩子(自 migrate.rs 拆出以守单文件 200 行):SQL 迁移里写不了日志,
//! 这些函数在应用对应迁移**之前**把"接下来会动什么"打到 stderr,给真实库升级留可排障的读数。
//! 只读、不改库;调用点见 migrate.rs 的 `run`(版本号常量也在这里,与钩子成对)。
use rusqlite::Connection;

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

/// 013 之前提示:将要删除的标签节点数、链接数与受影响笔记数(无命中则不打印)
pub(crate) fn warn_drop_done_doing(conn: &Connection) -> rusqlite::Result<()> {
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
