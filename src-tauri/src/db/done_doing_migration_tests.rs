//! 迁移 013(spec 2026-09-17 S5):删除 done/doing 标签子树。
//! ① 新库跑到最新版本后不含 done/doing
//! ② 旧库(停在 12,含两棵子树)升级:只删这两棵子树,笔记正文/created_at 一字节不改,
//!    其它标签与链接原样保留
//! ③ 幂等:user_version 退回 12 再跑一次不报错,读数不变
//! ④ 近似名不受影响:`donex`、`工作/done`、存量不可解析的 `done.` 全部保留
//! ⑤ FTS:`done` 关键词删后不再命中,正文关键词仍命中
use super::*;
use crate::db::repos::notes::notes_filter::empty;
use crate::db::repos::notes::{create_plain, query, FilterConditions};

const V_012: i64 = 12;

/// 015(标签别名表)的位次:本文件的夹具要经生产写路径造存量数据,而 link_paths
/// 自 015 起会先查 tag_aliases(见 db_at_012 的说明)
const V_015: i64 = 15;

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// 停在 012 的库(与 drop_updated_at_tests 同一做法:逐条执行原始 SQL 并推进版本号)。
/// 额外把 015 的别名表建好:自 015 起 link_paths(生产唯一保存漏斗)会先查 tag_aliases,
/// 而本夹具的存量数据走 create_plain 写入 —— 015 是 CREATE TABLE IF NOT EXISTS,
/// run() 后面重放它是空操作,不影响本文件对 013 的断言。
fn db_at_012() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    for (i, sql) in MIGRATIONS.iter().enumerate().take(V_012 as usize) {
        conn.execute_batch(sql).unwrap();
        conn.pragma_update(None, "user_version", (i + 1) as i64).unwrap();
    }
    conn.execute_batch(MIGRATIONS[(V_015 - 1) as usize]).unwrap();
    conn
}

/// 造数:两棵子树 + 对照标签 + 一条存量平铺标签(name == path)
fn seed(conn: &mut Connection) {
    for text in [
        "买牛奶 #done",
        "收尾工作 #doing/信息/工作",
        "看文档 #doing",
        "对照笔记 #待办/支付 #电影",
        "近似名 #donex #工作/done",
    ] {
        create_plain(conn, text).unwrap();
    }
    conn.execute(
        "INSERT INTO tags(name, parent_id, path, depth) VALUES('done.', NULL, 'done.', 1)",
        [],
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
    assert_eq!(count(&conn, "PRAGMA user_version"), latest_version());
    assert_eq!(subtree_tags(&conn), 0);
}

#[test]
fn upgrade_drops_both_subtrees_and_keeps_everything_else() {
    let mut c = db_at_012();
    seed(&mut c);
    assert_eq!(subtree_tags(&c), 4, "前置:done 1 个 + doing 根/子/孙 3 个");
    assert_eq!(subtree_links(&c), 3, "前置:done、doing、doing/信息/工作 各 1 条链接");
    let before = notes_snapshot(&c);

    run(&c).unwrap();

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
    let mut c = db_at_012();
    seed(&mut c);
    run(&c).unwrap();
    let after_first = notes_snapshot(&c);
    let tags_after = count(&c, "SELECT COUNT(*) FROM tags");
    let links_after = count(&c, "SELECT COUNT(*) FROM tag_links");

    // 退回 012 再跑:013 的 DELETE 重放命中 0 行,不得报错也不得改数
    c.pragma_update(None, "user_version", V_012).unwrap();
    run(&c).unwrap();
    assert_eq!(count(&c, "PRAGMA user_version"), latest_version());
    assert_eq!(subtree_tags(&c), 0);
    assert_eq!(notes_snapshot(&c), after_first);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags"), tags_after);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_links"), links_after);
}

#[test]
fn fts_loses_done_but_keeps_body_keyword() {
    let mut c = db_at_012();
    create_plain(&mut c, "买牛奶 #done").unwrap();
    let kw = |k: &str| FilterConditions { keyword: Some(k.into()), ..empty() };
    assert_eq!(query(&c, &kw("done"), 0).unwrap().len(), 1, "前置:done 可检索");

    c.pragma_update(None, "user_version", V_012).unwrap();
    run(&c).unwrap();

    assert!(query(&c, &kw("done"), 0).unwrap().is_empty(), "删后 done 不再命中");
    assert_eq!(query(&c, &kw("买牛奶"), 0).unwrap().len(), 1, "正文关键词仍命中");
}
