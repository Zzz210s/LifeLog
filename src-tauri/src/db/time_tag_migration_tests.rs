//! 008 时间标签回填迁移测试(spec 2026-09-15 第 4.4 节):
//! ①按 created_at 建 `时间排序/YYYY/MM/DD` 三级树并建链 ②同日复用同一批节点
//! ③created_at 解析失败的笔记跳过 ④幂等 ⑤已有时间标签的笔记不动。
//! 阶段 4(027)后老表已下架,断言改对 `entities`/`edges`/`entities_fts`(029 起聚合列叫 `paths`)。
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
    conn.pragma_update(None, "user_version", (V_008 - 1) as i64).unwrap();
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
            "SELECT t.path FROM edges l JOIN entities t ON t.id = l.target_id
             WHERE l.kind = 'link' AND l.source_id = ?1 AND t.path IS NOT NULL ORDER BY t.path",
        )
        .unwrap();
    let rows = stmt.query_map([note_id], |r| r.get(0)).unwrap();
    rows.map(|r| r.unwrap()).collect()
}

/// 库快照(标签路径与 tagging 链接全量),用于幂等断言
fn snapshot(conn: &Connection) -> String {
    let collect = |sql: &str| -> Vec<String> {
        let mut stmt = conn.prepare(sql).unwrap();
        let rows = stmt.query_map([], |r| r.get(0)).unwrap();
        rows.map(|r| r.unwrap()).collect()
    };
    let tags = collect("SELECT path FROM entities WHERE path IS NOT NULL ORDER BY path");
    let links = collect(
        "SELECT t.path || '@' || l.source_id FROM edges l JOIN entities t ON t.id = l.target_id
         WHERE l.kind = 'link' AND t.path IS NOT NULL ORDER BY 1",
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
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM entities WHERE path='时间排序/2026/09/15'"),
        1
    );
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL"),
        1 + 2 + 3 + 3 + 1,
        "时间根/年/月/日 + 旧标签"
    );
    // 结构:时间根 depth=1,年 2,月 3,日 4,父指针串起来
    let row = |p: &str| -> (i64, String) {
        conn.query_row(
            "SELECT depth, COALESCE((SELECT pp.path FROM entities pp WHERE pp.id = t.parent_id), '')
             FROM entities t WHERE t.path = ?1",
            [p],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
    };
    assert_eq!(row("时间排序"), (1, String::new()));
    assert_eq!(row("时间排序/2026"), (2, "时间排序".into()));
    assert_eq!(row("时间排序/2026/09"), (3, "时间排序/2026".into()));
    assert_eq!(row("时间排序/2026/09/15"), (4, "时间排序/2026/09".into()));
    // 011 起时间标签与自建标签完全同权,搜年份/月份会命中该时段的全部笔记(明示代价)
    let fts_tags: String = conn
        .query_row("SELECT paths FROM entities_fts WHERE rowid=?1", [a], |r| r.get(0))
        .unwrap();
    assert!(fts_tags.contains("工作"), "用户标签仍在:{fts_tags}");
    assert!(fts_tags.contains("时间排序/2026/09/15"), "011 起时间标签也进索引:{fts_tags}");
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM entities_fts \
             WHERE entities_fts MATCH '\"时间排序/2026/09/15\"*' AND meta <> '' \
               AND rowid IN (SELECT id FROM entities WHERE path IS NULL)"
        ),
        2,
        "a 与 b 同日(2026-09-15),两条都因时间标签命中"
    );
}

/// ③ 幂等:再次 `run` 不改库(版本闸门;老表已下架,不再重放 008 的 SQL)
#[test]
fn migration_008_is_idempotent() {
    let conn = old_db();
    note(&conn, "甲 #工作", "2026-09-15 08:30:00");
    note(&conn, "乙", "2025-01-02 00:00:00");
    run(&conn).unwrap();
    let after = snapshot(&conn);

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
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM entities WHERE path='时间排序/2026'"),
        0
    );
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM edges WHERE kind='link'"), 1);
}

/// ⑤ 空库(没有任何笔记)不留空容器:时间根不创建
#[test]
fn migration_008_creates_nothing_for_empty_db() {
    let conn = old_db();
    run(&conn).unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL"), 0);
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM entities WHERE path='时间排序'"),
        0
    );
}
