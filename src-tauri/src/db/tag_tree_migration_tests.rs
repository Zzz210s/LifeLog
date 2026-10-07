//! 006 标签树迁移测试:①存量平铺标签根化 ②tag_links 不变 ③FTS 聚合路径
//! ④幂等 ⑤非法名(含空格)保留。失败回滚见 migration_atomicity_tests。
use super::{apply, latest_version, run, MIGRATIONS};
use rusqlite::Connection;

/// 006 在迁移序列中的位次(1 起);旧库 = 应用到 006 之前。
/// 不写成“len - 1”是因为后续新增迁移(007 起)会改变末尾位置。
const V_006: usize = 6;

/// 019(笔记间链接表)的位次:`query` 的读取路径自 L2 起会带上出链,
/// 本文件的旧库夹具只到 006,跑 `query` 前得把这张表补上(与 done_doing_migration_tests
/// 里 create_plain 夹具补 019 同做法;019 是纯加表,重放无副作用)
const V_019: usize = 19;

/// 升级前旧库:应用到 006 之前为止,user_version 停在 5,外键开启(与真实运行时一致)
fn old_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    for sql in &MIGRATIONS[..(V_006 - 1)] {
        conn.execute_batch(sql).unwrap();
    }
    conn.pragma_update(None, "user_version", (V_006 - 1) as i64)
        .unwrap();
    conn
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn text(conn: &Connection, sql: &str) -> String {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// 只应用 006 本体(复现 run 对 006 的外键开关配对,但不带后续迁移):
/// 本文件关注 006 的行为,008 时间标签回填另有专门用例
/// (见 time_tag_migration_tests.rs),混在一起会让“不得动 tag_links”的断言被 008 新增的链污染。
fn apply_006(conn: &Connection) {
    conn.pragma_update(None, "foreign_keys", "OFF").unwrap();
    apply(conn, MIGRATIONS[V_006 - 1], V_006 as i64).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
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
    super::entities_tags_fixture::legacy_read_views(&conn);

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

    // 只应用 006 本体:本用例关注重建 tags 是否动 tag_links,
    // 后续迁移(008 时间标签回填)另有专门用例(见 time_tag_migration_tests.rs)
    apply_006(&conn);
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

    apply_006(&conn);
    // query 读取路径现在会读 note_links(L2 出链),旧库夹具只到 006:先补建该表
    conn.execute_batch(MIGRATIONS[V_019 - 1]).unwrap();
    // 迁移后按新语法建二级节点 `工作/项目A`,链接落在末端
    conn.execute_batch(
        "INSERT INTO tags(name, parent_id, path, depth)
           VALUES('项目A', 1, '工作/项目A', 2);
         INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(2, 'note', 1);",
    )
    .unwrap();

    // 触发器聚合的是完整路径,而非节点名(此用例停在 v6,读老 notes_fts)
    assert_eq!(text(&conn, "SELECT tags FROM notes_fts WHERE rowid=1"), "工作/项目A");
    let hits: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH '\"工作/项目A\"*'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(hits, 1, "标签路径应能被 FTS 搜到");
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
            count(c, "SELECT COUNT(*) FROM entities_fts"),
            text(c, "SELECT path FROM tags WHERE id = 1"),
            count(c, "PRAGMA user_version"),
        )
    };

    run(&conn).unwrap();
    super::entities_tags_fixture::legacy_read_views(&conn);
    let first = snapshot(&conn);
    run(&conn).unwrap();
    super::entities_tags_fixture::legacy_read_views(&conn); // user_version 已是最新,应为 no-op

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
    super::entities_tags_fixture::legacy_read_views(&conn);

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
