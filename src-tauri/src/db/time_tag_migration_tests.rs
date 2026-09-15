//! 008 时间标签回填迁移测试(spec 2026-09-15 第 4.4 节):
//! ①按 created_at 建 `时间排序/YYYY/MM/DD` 三级树并建链 ②同日复用同一批节点
//! ③created_at 解析失败的笔记跳过 ④幂等(重复执行不改库)⑤已有时间标签的笔记不动。
use super::{latest_version, run, MIGRATIONS};
use rusqlite::Connection;

/// 008 在迁移序列中的位次(1 起);旧库 = 应用到 008 之前(user_version 停在 7)
const V_008: usize = 8;

/// 模拟升级前旧库:到 007 为止,外键开启(与真实运行时一致)
fn old_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    for sql in &MIGRATIONS[..(V_008 - 1)] {
        conn.execute_batch(sql).unwrap();
    }
    conn.pragma_update(None, "user_version", (V_008 - 1) as i64)
        .unwrap();
    conn
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// 造一条带显式 created_at 的笔记(旧库里的历史数据)
fn note(conn: &Connection, content: &str, created_at: &str) -> i64 {
    conn.execute(
        "INSERT INTO notes(content, created_at, updated_at) VALUES(?1, ?2, ?2)",
        rusqlite::params![content, created_at],
    )
    .unwrap();
    conn.last_insert_rowid()
}

/// 该笔记的全部标签路径(升序),用于核对回填结果与旧标签未受影响
fn paths(conn: &Connection, note_id: i64) -> Vec<String> {
    let mut stmt = conn
        .prepare(
            "SELECT t.path FROM tag_links l JOIN tags t ON t.id = l.tag_id
             WHERE l.target_type = 'note' AND l.target_id = ?1 ORDER BY t.path",
        )
        .unwrap();
    let rows = stmt.query_map([note_id], |r| r.get(0)).unwrap();
    rows.map(|r| r.unwrap()).collect()
}

/// 库快照(tags 与 tag_links 全量),用于幂等断言
fn snapshot(conn: &Connection) -> String {
    let collect = |sql: &str| -> Vec<String> {
        let mut stmt = conn.prepare(sql).unwrap();
        let rows = stmt.query_map([], |r| r.get(0)).unwrap();
        rows.map(|r| r.unwrap()).collect()
    };
    let tags = collect("SELECT path FROM tags ORDER BY path");
    let links = collect(
        "SELECT t.path || '@' || l.target_id FROM tag_links l JOIN tags t ON t.id = l.tag_id
         WHERE l.target_type = 'note' ORDER BY 1",
    );
    format!("{}#{}", tags.join("|"), links.join("|"))
}

/// ① 按 created_at 回填(含跨年/跨月/同日复用),旧标签不动;② 解析失败的跳过
#[test]
fn migration_008_backfills_from_created_at() {
    let conn = old_db();
    let a = note(&conn, "甲", "2026-09-15 08:30:00");
    let b = note(&conn, "乙", "2026-09-15 09:30:00");
    let c = note(&conn, "丙", "2026-08-31 23:59:59");
    let d = note(&conn, "丁", "2025-01-02 00:00:00");
    let bad = note(&conn, "戊", "无法解析的值");
    // 存量用户标签与链接:回填不得动它
    conn.execute_batch(
        "INSERT INTO tags(name, parent_id, path, depth) VALUES('工作', NULL, '工作', 1);
         INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(1, 'note', 1);",
    )
    .unwrap();

    run(&conn).unwrap();

    assert_eq!(count(&conn, "PRAGMA user_version"), latest_version());
    // 每条可解析的笔记各得一个时间标签,路径严格等于 created_at 的日期
    assert_eq!(paths(&conn, a), vec!["工作", "时间排序/2026/09/15"]);
    assert_eq!(paths(&conn, b), vec!["时间排序/2026/09/15"]);
    assert_eq!(paths(&conn, c), vec!["时间排序/2026/08/31"]);
    assert_eq!(paths(&conn, d), vec!["时间排序/2025/01/02"]);
    // 解析失败:跳过该条(其余笔记照常回填)
    assert!(paths(&conn, bad).is_empty(), "无法解析的 created_at 应跳过");
    // 同日复用同一批节点:树行数与路径一一对应(2026/2025 + 三个月 + 三个日,含时间根)
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM tags WHERE path='时间排序/2026/09/15'"), 1);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM tags"), 1 + 2 + 3 + 3 + 1, "时间根/年/月/日 + 旧标签");
    // 结构:时间根 depth=1,年 2,月 3,日 4,父指针串起来
    let row = |p: &str| -> (i64, String) {
        conn.query_row(
            "SELECT depth, COALESCE((SELECT pp.path FROM tags pp WHERE pp.id = t.parent_id), '')
             FROM tags t WHERE t.path = ?1",
            [p],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
    };
    assert_eq!(row("时间排序"), (1, String::new()));
    assert_eq!(row("时间排序/2026"), (2, "时间排序".into()));
    assert_eq!(row("时间排序/2026/09"), (3, "时间排序/2026".into()));
    assert_eq!(row("时间排序/2026/09/15"), (4, "时间排序/2026/09".into()));
    // FTS 的 tags 列只收时间子树之外的标签(009):时间标签不再靠关键词命中,
    // 用户标签照旧在索引里(时间由日期筛选负责,不靠关键词)
    let fts_tags: String = conn
        .query_row("SELECT tags FROM notes_fts WHERE rowid=?1", [a], |r| r.get(0))
        .unwrap();
    assert_eq!(fts_tags, "工作", "只留用户标签:{fts_tags}");
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH '\"时间排序\"*'"),
        0
    );
}

/// ③ 幂等:重复执行(手动重放 + 再次 run)都不改库
#[test]
fn migration_008_is_idempotent() {
    let conn = old_db();
    note(&conn, "甲 #工作", "2026-09-15 08:30:00");
    note(&conn, "乙", "2025-01-02 00:00:00");
    run(&conn).unwrap();
    let after = snapshot(&conn);

    // 直接重放 008 的 SQL:版本闸门之外的兜底幂等(语句级 INSERT OR IGNORE)
    conn.execute_batch(MIGRATIONS[V_008 - 1]).unwrap();
    run(&conn).unwrap();

    assert_eq!(snapshot(&conn), after, "重复执行必须不改库");
    assert_eq!(count(&conn, "PRAGMA user_version"), latest_version());
}

/// ④ 已有时间标签的笔记不动(用户手打或上次回填),不因 created_at 另建一棵
#[test]
fn migration_008_keeps_existing_time_tags() {
    let conn = old_db();
    let n = note(&conn, "甲", "2026-09-15 08:30:00");
    conn.execute_batch(
        "INSERT INTO tags(name, parent_id, path, depth) VALUES('时间排序', NULL, '时间排序', 1);
         INSERT INTO tags(name, parent_id, path, depth) VALUES('2020', (SELECT id FROM tags WHERE path='时间排序'), '时间排序/2020', 2);
         INSERT INTO tags(name, parent_id, path, depth) VALUES('05', (SELECT id FROM tags WHERE path='时间排序/2020'), '时间排序/2020/05', 3);
         INSERT INTO tags(name, parent_id, path, depth) VALUES('05', (SELECT id FROM tags WHERE path='时间排序/2020/05'), '时间排序/2020/05/05', 4);
         INSERT INTO tag_links(tag_id, target_type, target_id)
           VALUES((SELECT id FROM tags WHERE path='时间排序/2020/05/05'), 'note', (SELECT id FROM notes LIMIT 1));",
    )
    .unwrap();

    run(&conn).unwrap();

    assert_eq!(paths(&conn, n), vec!["时间排序/2020/05/05"], "已有时间标签不得被改写");
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM tags WHERE path='时间排序/2026'"), 0);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM tag_links WHERE target_type='note'"), 1);
}

/// ⑤ 空库(没有任何笔记)不留空容器:时间根不创建
#[test]
fn migration_008_creates_nothing_for_empty_db() {
    let conn = old_db();
    run(&conn).unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM tags"), 0);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM tags WHERE path='时间排序'"), 0);
}
