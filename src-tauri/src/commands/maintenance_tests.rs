//! 重建全文索引的回归:重建结果必须与触发器维护的索引串逐行一致(迁移 011 的聚合口径)。
use super::*;
use crate::db::repos::tags::invariants_tests::assert_fts_matches_tags;
use crate::db::{migrate, repos};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

/// 索引快照:rowid|content|tags,按 rowid 升序(逐行比对用)
fn fts_rows(c: &Connection) -> Vec<String> {
    let mut stmt = c
        .prepare("SELECT rowid || '|' || content || '|' || tags FROM notes_fts ORDER BY rowid")
        .unwrap();
    stmt.query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap()
}

#[test]
fn rebuild_restores_rows_identical_to_trigger_written_index() {
    let mut c = db();
    repos::notes::create(&mut c, "买牛奶 #生活").unwrap();
    repos::notes::create(&mut c, "写周报 #工作/项目A").unwrap();
    let want = fts_rows(&c);
    assert_eq!(want.len(), 2);

    c.execute("DELETE FROM notes_fts", []).unwrap();
    assert!(fts_rows(&c).is_empty(), "先清空才能证明重建真的写了行");

    let written = rebuild(&c).unwrap();
    assert_eq!(written, 2);
    assert_eq!(fts_rows(&c), want, "重建后的索引串必须与触发器口径逐行一致");
    assert_fts_matches_tags(&c);
}

#[test]
fn rebuild_is_idempotent_and_keeps_rows_searchable() {
    let mut c = db();
    repos::notes::create(&mut c, "独一无二的关键词").unwrap();
    rebuild(&c).unwrap();
    rebuild(&c).unwrap();
    assert_eq!(fts_rows(&c).len(), 1, "重复重建不得产生重复行");
    let hits: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH '关键词'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(hits, 1, "重建后 3 字符以上关键词仍要能被 FTS 命中");
}

/// T6 复审 m1:DELETE 与 INSERT 必须同一事务 —— 中途失败不得留下空索引。
/// 用「聚合口径引用的 tags 表不在」制造 INSERT 阶段的失败:DELETE 已经跑过,
/// 若两条各自 autocommit,此时 notes_fts 就空了;包进事务则整体回滚,原索引原样保留。
#[test]
fn rebuild_is_atomic_failed_rebuild_keeps_index_intact() {
    let mut c = db();
    repos::notes::create(&mut c, "买牛奶 #生活").unwrap();
    repos::notes::create(&mut c, "写周报 #工作/项目A").unwrap();
    let before = fts_rows(&c);
    assert_eq!(before.len(), 2);

    c.execute("DROP TABLE tag_links", []).unwrap();
    c.execute("DROP TABLE tags", []).unwrap();

    assert!(rebuild(&c).is_err(), "缺表时重建必须报错,而不是静默写坏索引");
    assert_eq!(
        fts_rows(&c),
        before,
        "重建失败不得留下空索引(DELETE 与 INSERT 必须同一事务)"
    );
}
