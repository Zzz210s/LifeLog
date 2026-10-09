//! 重建全文索引的回归:重建结果必须与触发器维护的 `entities_fts` 逐行一致(迁移 029 的统一聚合口径,
//! 重建与触发器都从视图 `entities_fts_src` 取数)。
use super::*;
use crate::db::repos::tags::invariants_tests::{assert_fts_matches_edges, assert_is_cited_matches_edges};
use crate::db::migrate;
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c.execute_batch(
        "INSERT INTO entities(id,meta,created_at,path,depth) VALUES
           (1,'买牛奶','2026-01-01',NULL,NULL),
           (2,'写周报','2026-01-01',NULL,NULL),
           (3,'生活','2026-01-01','生活',1),
           (4,'项目A','2026-01-01','工作/项目A',2),
           (5,'工作','2026-01-01','工作',1);
         INSERT INTO edges(source_id,target_id,kind,created_at) VALUES
           (1,3,'link','2026-01-01'),(2,4,'link','2026-01-01'),(5,4,'child','2026-01-01');
         INSERT INTO entity_aliases(alias,entity_id) VALUES('日常',3);",
    )
    .unwrap();
    c
}

/// 索引快照:rowid|meta|paths,按 rowid 升序(逐行比对用)
fn fts_rows(c: &Connection) -> Vec<String> {
    let mut stmt = c
        .prepare("SELECT rowid || '|' || meta || '|' || paths FROM entities_fts ORDER BY rowid")
        .unwrap();
    stmt.query_map([], |r| r.get::<_, String>(0)).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap()
}

/// 实体总数:笔记与标签实体都进 `entities_fts`,重建后行数必须等于它
fn entity_count(c: &Connection) -> i64 {
    c.query_row("SELECT COUNT(*) FROM entities", [], |r| r.get(0)).unwrap()
}

#[test]
fn rebuild_restores_rows_identical_to_trigger_written_index() {
    let c = db();
    let want = fts_rows(&c);
    assert_eq!(want.len() as i64, entity_count(&c), "重建前行数 == entities 行数");
    assert!(want.iter().any(|r| r.contains("生活")), "触发器已写出带引用段的行");

    c.execute("DELETE FROM entities_fts", []).unwrap();
    assert!(fts_rows(&c).is_empty(), "先清空才能证明重建真的写了行");

    let written = rebuild(&c).unwrap();
    assert_eq!(written as i64, entity_count(&c));
    assert_eq!(fts_rows(&c), want, "重建后的索引串必须与触发器口径逐行一致");
    assert_fts_matches_edges(&c);
    assert_is_cited_matches_edges(&c);
}

#[test]
fn rebuild_is_idempotent_and_keeps_rows_searchable() {
    let c = db();
    c.execute(
        "INSERT INTO entities(id,meta,created_at) VALUES(9,'独一无二的关键词','2026-01-01')",
        [],
    )
    .unwrap();
    rebuild(&c).unwrap();
    rebuild(&c).unwrap();
    assert_eq!(fts_rows(&c).len() as i64, entity_count(&c), "重复重建不得产生重复行");
    let hits: i64 = c
        .query_row("SELECT COUNT(*) FROM entities_fts WHERE entities_fts MATCH '关键词'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(hits, 1, "重建后 3 字符以上关键词仍要能被 FTS 命中");
}

/// T6 复审 m1:DELETE 与 INSERT 必须同一事务 —— 中途失败不得留下空索引。
/// 用「聚合视图引用的表不在」制造 INSERT 阶段的失败:DELETE 已经跑过,
/// 若两条各自 autocommit,此时 entities_fts 就空了;包进事务则整体回滚,原索引原样保留。
/// 拿掉的是 `entity_aliases`(视图 `entities_fts_src` 的自身段要读别名表)。
#[test]
fn rebuild_is_atomic_failed_rebuild_keeps_index_intact() {
    let c = db();
    let before = fts_rows(&c);
    assert_eq!(before.len() as i64, entity_count(&c));

    c.execute("DROP TABLE entity_aliases", []).unwrap();

    assert!(rebuild(&c).is_err(), "缺表时重建必须报错,而不是静默写坏索引");
    assert_eq!(fts_rows(&c), before, "重建失败不得留下空索引(DELETE 与 INSERT 必须同一事务)");
}
