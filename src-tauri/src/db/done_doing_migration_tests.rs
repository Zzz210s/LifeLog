//! 迁移 013(spec 2026-09-17 S5):删除 done/doing 标签子树。
//! 终态读法:028 后树内实体 = `path IS NOT NULL`、树外 = `path IS NULL`,引用边一律 `kind='link'`;
//! 迁移前的读数走老表(夹具停在 v12,老表还在)。
//! ① 新库跑到最新版本后不含 done/doing
//! ② 旧库(停在 12,含两棵子树)升级:只删这两棵子树,笔记正文/created_at 一字节不改,
//!    其它标签与链接原样保留
//! ③ 幂等:再次 `run` 不报错,读数不变
//! ④ 近似名不受影响:`donex`、`工作/done`、存量不可解析的 `done.` 全部保留
//! ⑤ FTS:见同模块 `done_doing_fts_tests.rs`(`done` 关键词删后不再命中,正文关键词仍命中)
use super::entities_tags_fixture::{db_at_012, table_exists};
use super::*;

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// 造数(直接写老表,不经生产写路径):两棵子树 + 对照标签 + 存量平铺标签 `done.`。
fn seed(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO notes(id, content, created_at) VALUES
           (1,'买牛奶','2026-01-01'),(2,'收尾工作','2026-01-01'),(3,'看文档','2026-01-01'),
           (4,'对照笔记','2026-01-01'),(5,'近似名','2026-01-01');
         INSERT INTO tags(id, name, parent_id, path, depth, sort_order) VALUES
           (1,'done',NULL,'done',1,0),
           (2,'doing',NULL,'doing',1,0),(3,'信息',2,'doing/信息',2,0),
           (4,'工作',3,'doing/信息/工作',3,0),
           (5,'待办',NULL,'待办',1,0),(6,'支付',5,'待办/支付',2,0),
           (7,'电影',NULL,'电影',1,0),(8,'donex',NULL,'donex',1,0),
           (9,'工作',NULL,'工作',1,0),(10,'done',9,'工作/done',2,0),
           (11,'done.',NULL,'done.',1,0);
         INSERT INTO tag_links(tag_id, target_type, target_id) VALUES
           (1,'note',1),(4,'note',2),(2,'note',3),(6,'note',4),(7,'note',4),
           (8,'note',5),(10,'note',5);",
    )
    .unwrap();
}

/// done/doing 子树的路径谓词:老 `tags` 与终态 `entities` 都有 `path` 列,同一段 SQL 两边通用
const SUBTREE_PATHS: &str = "path = 'done' OR substr(path, 1, 5) = 'done/'
                             OR path = 'doing' OR substr(path, 1, 6) = 'doing/'";

/// 子树标签数:老库读 `tags`,终态读 `entities`(`path IS NOT NULL` 即树内)
fn subtree_tags(conn: &Connection) -> i64 {
    if table_exists(conn, "tags") {
        count(conn, &format!("SELECT COUNT(*) FROM tags WHERE {SUBTREE_PATHS}"))
    } else {
        count(
            conn,
            &format!("SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND ({SUBTREE_PATHS})"),
        )
    }
}

/// 子树上的引用边数:老库读 `tag_links`,终态读 `edges(kind='link')` 的两端
/// (028 把 tagging / relation / link 全并成 `link`)
fn subtree_links(conn: &Connection) -> i64 {
    if table_exists(conn, "tag_links") {
        count(
            conn,
            &format!(
                "SELECT COUNT(*) FROM tag_links WHERE tag_id IN \
                 (SELECT id FROM tags WHERE {SUBTREE_PATHS})"
            ),
        )
    } else {
        let ids = format!("SELECT id FROM entities WHERE path IS NOT NULL AND ({SUBTREE_PATHS})");
        count(
            conn,
            &format!(
                "SELECT COUNT(*) FROM edges e WHERE e.kind = 'link' \
                 AND (e.target_id IN ({ids}) OR e.source_id IN ({ids}))"
            ),
        )
    }
}

/// 终态树内实体数(≤ v27 `tags` 行数的等价读法)
fn tag_count(conn: &Connection) -> i64 {
    count(conn, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL")
}

/// 终态树外实体数(≤ v27 `notes` 行数的等价读法)
fn note_count(conn: &Connection) -> i64 {
    count(conn, "SELECT COUNT(*) FROM entities WHERE path IS NULL")
}

/// (id, 正文, created_at) 快照:正文与创建时间必须逐字节不变。
/// 老库 5 条笔记的 id 全小于标签 id,028 重发 id 时笔记仍拿 1..5,故前后快照可直接比。
fn notes_snapshot(conn: &Connection) -> Vec<(i64, String, String)> {
    if table_exists(conn, "notes") {
        let mut stmt =
            conn.prepare("SELECT id, content, created_at FROM notes ORDER BY id").unwrap();
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        return rows.collect::<rusqlite::Result<Vec<_>>>().unwrap();
    }
    let mut stmt = conn
        .prepare("SELECT id, meta, created_at FROM entities WHERE path IS NULL ORDER BY id")
        .unwrap();
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
    rows.collect::<rusqlite::Result<Vec<_>>>().unwrap()
}

#[test]
fn fresh_db_has_no_done_or_doing_subtree() {
    let conn = Connection::open_in_memory().unwrap();
    run(&conn).unwrap();
    assert_eq!(count(&conn, "PRAGMA user_version"), latest_version());
    assert_eq!(subtree_tags(&conn), 0);
}

#[test]
fn upgrade_drops_both_subtrees_and_keeps_everything_else() {
    let c = db_at_012();
    seed(&c);
    assert_eq!(subtree_tags(&c), 4, "前置:done 1 个 + doing 根/子/孙 3 个");
    assert_eq!(subtree_links(&c), 3, "前置:done、doing、doing/信息/工作 各 1 条链接");
    let before = notes_snapshot(&c);

    run(&c).unwrap();

    assert_eq!(count(&c, "PRAGMA user_version"), latest_version());
    assert_eq!(subtree_tags(&c), 0, "done/doing 连子孙一起删");
    assert_eq!(subtree_links(&c), 0);
    assert_eq!(notes_snapshot(&c), before, "正文与 created_at 一字节不改");
    assert_eq!(note_count(&c), 5);
    // 对照标签原样:待办(含父级)、电影、donex、工作/done、存量 done.
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path='待办'"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path='待办/支付'"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path='电影'"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path='donex'"), 1, "donex 不是 done");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path='工作/done'"), 1, "末级同名不删");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path='done.'"), 1, "存量平铺标签不删");
}

#[test]
fn migration_is_idempotent_when_replayed() {
    let c = db_at_012();
    seed(&c);
    run(&c).unwrap();
    let after_first = notes_snapshot(&c);
    let tags_after = tag_count(&c);
    let links_after = count(&c, "SELECT COUNT(*) FROM edges WHERE kind='link'");

    run(&c).unwrap(); // 版本闸门:第二次 no-op
    assert_eq!(count(&c, "PRAGMA user_version"), latest_version());
    assert_eq!(subtree_tags(&c), 0);
    assert_eq!(notes_snapshot(&c), after_first);
    assert_eq!(tag_count(&c), tags_after);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges WHERE kind='link'"), links_after);
}

