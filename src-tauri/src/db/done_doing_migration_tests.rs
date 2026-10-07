//! 迁移 013(spec 2026-09-17 S5):删除 done/doing 标签子树。
//! 阶段 4(027)后老表已下架:老表断言走 `legacy_read_views` 的只读投影(见夹具模块)。
//! ① 新库跑到最新版本后不含 done/doing
//! ② 旧库(停在 12,含两棵子树)升级:只删这两棵子树,笔记正文/created_at 一字节不改,
//!    其它标签与链接原样保留
//! ③ 幂等:再次 `run` 不报错,读数不变
//! ④ 近似名不受影响:`donex`、`工作/done`、存量不可解析的 `done.` 全部保留
//! ⑤ FTS:`done` 关键词删后不再命中,正文关键词仍命中
use super::*;
use crate::db::repos::notes::notes_filter::empty;
use crate::db::repos::notes::{query, FilterConditions};

const V_012: i64 = 12;

/// 015(标签别名表)的位次:本文件的夹具要直接摆老表数据,`link_paths` 自 015 起会先查 tag_aliases。
const V_015: usize = 15;
/// 019(笔记间链接表)的位次:同理 —— 生产保存路径自 019 起会写 note_links。
const V_019: usize = 19;
/// 020(标签角色表)的位次:孤儿回收自 020 起会读 `roles` 表。
const V_020: usize = 20;

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// 停在 012 的库(逐条执行原始 SQL 并推进版本号),并把 015/019/020 的纯加表补上。
fn db_at_012() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    for (i, sql) in MIGRATIONS.iter().enumerate().take(V_012 as usize) {
        conn.execute_batch(sql).unwrap();
        conn.pragma_update(None, "user_version", (i + 1) as i64).unwrap();
    }
    conn.execute_batch(MIGRATIONS[V_015 - 1]).unwrap();
    conn.execute_batch(MIGRATIONS[V_019 - 1]).unwrap();
    conn.execute_batch(MIGRATIONS[V_020 - 1]).unwrap();
    crate::db::migration_hooks::ensure_is_type_column(&conn).unwrap();
    conn
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

fn subtree_tags(conn: &Connection) -> i64 {
    count(
        conn,
        "SELECT COUNT(*) FROM tags WHERE path = 'done' OR substr(path, 1, 5) = 'done/'
           OR path = 'doing' OR substr(path, 1, 6) = 'doing/'",
    )
}

fn subtree_links(conn: &Connection) -> i64 {
    count(
        conn,
        "SELECT COUNT(*) FROM tag_links WHERE tag_id IN (SELECT id FROM tags
           WHERE path = 'done' OR substr(path, 1, 5) = 'done/'
              OR path = 'doing' OR substr(path, 1, 6) = 'doing/')",
    )
}

/// (id, content, created_at) 快照:正文与创建时间必须逐字节不变
fn notes_snapshot(conn: &Connection) -> Vec<(i64, String, String)> {
    let mut stmt = conn.prepare("SELECT id, content, created_at FROM notes ORDER BY id").unwrap();
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
    rows.collect::<rusqlite::Result<Vec<_>>>().unwrap()
}

#[test]
fn fresh_db_has_no_done_or_doing_subtree() {
    let conn = Connection::open_in_memory().unwrap();
    run(&conn).unwrap();
    super::entities_tags_fixture::legacy_read_views(&conn);
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
    super::entities_tags_fixture::legacy_read_views(&c);

    assert_eq!(count(&c, "PRAGMA user_version"), latest_version());
    assert_eq!(subtree_tags(&c), 0, "done/doing 连子孙一起删");
    assert_eq!(subtree_links(&c), 0);
    assert_eq!(notes_snapshot(&c), before, "正文与 created_at 一字节不改");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM notes"), 5);
    // 对照标签原样:待办(含父级)、电影、donex、工作/done、存量 done.
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='待办'"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='待办/支付'"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='电影'"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='donex'"), 1, "donex 不是 done");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='工作/done'"), 1, "末级同名不删");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='done.'"), 1, "存量平铺标签不删");
}

#[test]
fn migration_is_idempotent_when_replayed() {
    let c = db_at_012();
    seed(&c);
    run(&c).unwrap();
    super::entities_tags_fixture::legacy_read_views(&c);
    let after_first = notes_snapshot(&c);
    let tags_after = count(&c, "SELECT COUNT(*) FROM tags");
    let links_after = count(&c, "SELECT COUNT(*) FROM tag_links");

    run(&c).unwrap(); // 版本闸门:第二次 no-op
    assert_eq!(count(&c, "PRAGMA user_version"), latest_version());
    assert_eq!(subtree_tags(&c), 0);
    assert_eq!(notes_snapshot(&c), after_first);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags"), tags_after);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_links"), links_after);
}

#[test]
fn fts_loses_done_but_keeps_body_keyword() {
    let c = db_at_012();
    // 精简夹具:只一条笔记 + 一个 done 标签,单独钉 FTS 行为
    c.execute_batch(
        "INSERT INTO notes(id, content, created_at) VALUES(1,'买牛奶','2026-01-01');
         INSERT INTO tags(id, name, parent_id, path, depth, sort_order) VALUES(1,'done',NULL,'done',1,0);
         INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(1,'note',1);",
    )
    .unwrap();
    let pre: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH 'done'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(pre, 1, "前置:done 可检索(此时尚无 entities_fts,读老索引)");

    run(&c).unwrap();
    super::entities_tags_fixture::legacy_read_views(&c);

    let kw = |k: &str| FilterConditions { keyword: Some(k.into()), ..empty() };
    assert!(query(&c, &kw("done"), 0).unwrap().is_empty(), "删后 done 不再命中");
    assert_eq!(query(&c, &kw("买牛奶"), 0).unwrap().len(), 1, "正文关键词仍命中");
}
