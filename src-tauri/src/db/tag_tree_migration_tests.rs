//! 006 标签树迁移测试:①存量平铺标签根化 ②tag_links 不变 ③FTS 聚合路径
//! ④幂等 ⑤非法名(含空格)保留。失败回滚见 migration_atomicity_tests。
use super::{latest_version, run, MIGRATIONS};
use crate::db::repos::notes::{notes_filter::*, query};
use rusqlite::Connection;

/// 升级前旧库:应用到 006 之前为止,user_version 停在 5,外键开启(与真实运行时一致)
fn old_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    for sql in &MIGRATIONS[..MIGRATIONS.len() - 1] {
        conn.execute_batch(sql).unwrap();
    }
    conn.pragma_update(None, "user_version", (MIGRATIONS.len() - 1) as i64)
        .unwrap();
    conn
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn text(conn: &Connection, sql: &str) -> String {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// tag_links 全量快照(排序后与顺序无关)
fn link_rows(conn: &Connection) -> Vec<(i64, String, i64)> {
    let mut stmt = conn
        .prepare("SELECT tag_id, target_type, target_id FROM tag_links ORDER BY 1,2,3")
        .unwrap();
    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap()
}

#[test]
fn migration_006_turns_flat_tags_into_roots() {
    let conn = old_db();
    conn.execute_batch(
        "INSERT INTO tags(name) VALUES('工作'), ('电影'), ('读书笔记');",
    )
    .unwrap();

    run(&conn).unwrap();

    let mut stmt = conn
        .prepare("SELECT id, name, parent_id, path, depth FROM tags ORDER BY id")
        .unwrap();
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<i64>>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
            ))
        })
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert_eq!(
        rows,
        vec![
            (1, "工作".into(), None, "工作".into(), 1),
            (2, "电影".into(), None, "电影".into(), 1),
            (3, "读书笔记".into(), None, "读书笔记".into(), 1),
        ]
    );
    assert_eq!(count(&conn, "PRAGMA user_version"), latest_version());
}

#[test]
fn migration_006_keeps_tag_links_untouched() {
    let conn = old_db();
    conn.execute_batch(
        "INSERT INTO notes(content) VALUES('a'), ('b');
         INSERT INTO tags(name) VALUES('x'), ('y');
         INSERT INTO tag_links(tag_id, target_type, target_id)
           VALUES(1,'note',1), (1,'note',2), (2,'note',2);",
    )
    .unwrap();
    let before = link_rows(&conn);

    run(&conn).unwrap();

    assert_eq!(link_rows(&conn), before, "重建 tags 不得动 tag_links 数据");
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM tags"), 2);
    // 外键校验无违规,且外键开关已恢复为 ON(配对开关不能把连接留在 OFF)
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM pragma_foreign_key_check"), 0);
    assert_eq!(count(&conn, "PRAGMA foreign_keys"), 1, "迁移后外键必须回到 ON");
}

#[test]
fn migration_006_indexes_tag_paths_for_search() {
    let conn = old_db();
    conn.execute_batch(
        "INSERT INTO notes(content) VALUES('一条笔记');
         INSERT INTO tags(name) VALUES('工作');",
    )
    .unwrap();

    run(&conn).unwrap();

    // 迁移后按新语法建二级节点 `工作/项目A`,链接落在末端
    conn.execute_batch(
        "INSERT INTO tags(name, parent_id, path, depth)
           VALUES('项目A', 1, '工作/项目A', 2);
         INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(2, 'note', 1);",
    )
    .unwrap();

    // 触发器聚合的是完整路径,而非节点名
    assert_eq!(text(&conn, "SELECT tags FROM notes_fts WHERE rowid=1"), "工作/项目A");
    let hit = query(
        &conn,
        &FilterConditions {
            keyword: Some("项目A".into()),
            ..empty()
        },
        0,
    )
    .unwrap();
    assert_eq!(hit.len(), 1, "标签路径应能被 FTS 搜到");
}

#[test]
fn migration_006_is_idempotent() {
    let conn = old_db();
    conn.execute_batch(
        "INSERT INTO notes(content) VALUES('n');
         INSERT INTO tags(name) VALUES('x');
         INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(1, 'note', 1);",
    )
    .unwrap();
    let snapshot = |c: &Connection| {
        (
            count(c, "SELECT COUNT(*) FROM tags"),
            count(c, "SELECT COUNT(*) FROM tag_links"),
            count(c, "SELECT COUNT(*) FROM notes_fts"),
            text(c, "SELECT path FROM tags WHERE id = 1"),
            count(c, "PRAGMA user_version"),
        )
    };

    run(&conn).unwrap();
    let first = snapshot(&conn);
    run(&conn).unwrap(); // user_version 已是最新,应为 no-op

    assert_eq!(snapshot(&conn), first);
}

#[test]
fn migration_006_keeps_legacy_names_with_spaces() {
    let conn = old_db();
    conn.execute_batch(
        "INSERT INTO tags(name) VALUES('工作 计划'), ('a.b'), ('待定/TBD');",
    )
    .unwrap();

    run(&conn).unwrap();

    for name in ["工作 计划", "a.b", "待定/TBD"] {
        let n = count(
            &conn,
            &format!(
                "SELECT COUNT(*) FROM tags WHERE name='{name}' AND path='{name}' \
                 AND depth=1 AND parent_id IS NULL"
            ),
        );
        assert_eq!(n, 1, "存量标签 {name} 必须原样保留为根节点");
    }
}
