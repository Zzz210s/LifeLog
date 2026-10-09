//! 按 id 替换链接的仓库层测试(测试先行 TDD)。
//! S5 删除「切换待办」后,本文件只剩 replace_links 的行为覆盖:
//! 增量替换(未变化的链接不动)与孤儿标签回收。
use super::replace::replace_links;
use super::*;
use crate::db::migrate;
use crate::db::repos::notes;
use crate::db::repos::tags::invariants_tests::{assert_fts_matches_edges, assert_no_orphan_tags};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM entities WHERE path IS NOT NULL AND path=?1", [path], |r| r.get(0))
        .unwrap()
}

/// replace_links:增量替换(未变化的链接不动),无引用且无子节点的标签被回收
#[test]
fn replace_links_replaces_by_id_and_prunes_orphans() {
    let mut c = db();
    let n = notes::create_plain(&mut c, "x #甲").unwrap();
    let jia = id_at(&c, "甲");
    let yi = ensure_path(&c, &["乙".to_string()]).unwrap();

    replace_links(&c, n.id, &[jia, yi]).unwrap();
    replace_links(&c, n.id, &[jia, yi]).unwrap();
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM edges e JOIN entities s ON s.id = e.source_id JOIN entities t ON t.id = e.target_id WHERE e.kind = 'link' AND (s.path IS NOT NULL OR t.path IS NOT NULL) AND (CASE WHEN s.path IS NOT NULL THEN e.target_id ELSE e.source_id END)={}", n.id)), 2);
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND id={jia}")), 1);

    replace_links(&c, n.id, &[yi]).unwrap();
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND id={jia}")), 0, "无链接又无子节点即回收");
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND id={yi}")), 1);
    assert_fts_matches_edges(&c);
    assert_no_orphan_tags(&c);
}
