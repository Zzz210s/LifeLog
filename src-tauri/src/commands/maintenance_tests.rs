//! 重建全文索引的回归(v31 点/线):重建结果必须与触发器维护的 `points_fts` 逐行一致
//! (两者都从视图 `points_fts_src` 取数),且重建行数 == **非纯名字点数**。
use super::*;
use crate::db::migrate;
use crate::db::repos::tags::invariants_tests::{assert_fts_matches_edges, assert_is_cited_matches_edges};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c.execute_batch(
        "INSERT INTO points(id,meta,created_at,path,depth) VALUES
           (1,'买牛奶','2026-01-01',NULL,NULL),
           (2,'写周报','2026-01-01',NULL,NULL),
           (3,'生活','2026-01-01','生活',1),
           (4,'项目A','2026-01-01','工作/项目A',2),
           (5,'工作','2026-01-01','工作',1);
         INSERT INTO lines(from_id,to_id,name_id,created_at) VALUES
           (1,3,NULL,'2026-01-01'),(2,4,NULL,'2026-01-01'),(5,4,0,'2026-01-01');
         INSERT INTO entity_aliases(alias,entity_id) VALUES('日常',3);",
    )
    .unwrap();
    c
}

/// 索引快照:rowid|meta|paths,按 rowid 升序(逐行比对用)
fn fts_rows(c: &Connection) -> Vec<String> {
    let mut stmt = c
        .prepare("SELECT rowid || '|' || meta || '|' || paths FROM points_fts ORDER BY rowid")
        .unwrap();
    stmt.query_map([], |r| r.get::<_, String>(0)).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap()
}

/// 应进 FTS 的点数 = 全部点 − 纯名字点(位置判据,与视图 `points_fts_src` 同口径)。
/// 夹具里的保留点 `子级`(id = 0)是纯名字点,不计。
fn indexable_count(c: &Connection) -> i64 {
    c.query_row(
        "SELECT COUNT(*) FROM points e WHERE NOT (EXISTS(SELECT 1 FROM lines nl \
         WHERE nl.name_id = e.id) AND NOT EXISTS(SELECT 1 FROM lines tl \
         WHERE tl.from_id = e.id OR tl.to_id = e.id)) AND e.id <> 0",
        [],
        |r| r.get(0),
    )
    .unwrap()
}

/// 全部点数(含保留点 `子级`):`get_db_info` 的「条目 N 条」同口径(spec §7.2)
fn point_count(c: &Connection) -> i64 {
    c.query_row("SELECT COUNT(*) FROM points", [], |r| r.get(0)).unwrap()
}

#[test]
fn rebuild_restores_rows_identical_to_trigger_written_index() {
    let c = db();
    let want = fts_rows(&c);
    assert_eq!(want.len() as i64, indexable_count(&c), "重建前行数 == 非纯名字点数");
    assert_eq!(want.len(), 5, "夹具 5 个内容点;保留点不进 FTS");
    assert_eq!(point_count(&c), 6, "points 含保留点共 6 行");
    assert!(want.iter().any(|r| r.contains("生活")), "触发器已写出带引用段的行");

    c.execute("DELETE FROM points_fts", []).unwrap();
    assert!(fts_rows(&c).is_empty(), "先清空才能证明重建真的写了行");

    let written = rebuild(&c).unwrap();
    assert_eq!(written as i64, indexable_count(&c));
    assert_eq!(fts_rows(&c), want, "重建后的索引串必须与触发器口径逐行一致");
    assert_fts_matches_edges(&c);
    assert_is_cited_matches_edges(&c);
}

/// T2.4 用例 ①:重建行数 == 非纯名字点数;重复重建幂等且不丢可搜性。
#[test]
fn rebuild_search_index_counts_non_pure_name_points_and_is_idempotent() {
    let c = db();
    c.execute(
        "INSERT INTO points(id,meta,created_at) VALUES(9,'独一无二的关键词','2026-01-01')",
        [],
    )
    .unwrap();
    let first = rebuild(&c).unwrap();
    assert_eq!(first as i64, indexable_count(&c), "重建行数 == 非纯名字点数");
    let second = rebuild(&c).unwrap();
    assert_eq!(second, first, "重复重建行数不变");
    let rows = fts_rows(&c);
    assert_eq!(rows.len(), first, "重复重建不得产生重复行");
    let hits: i64 = c
        .query_row("SELECT COUNT(*) FROM points_fts WHERE points_fts MATCH '关键词'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(hits, 1, "重建后 3 字符以上关键词仍要能被 FTS 命中");
    assert_fts_matches_edges(&c);
}

/// T6 复审 m1:DELETE 与 INSERT 必须同一事务 —— 中途失败不得留下空索引。
/// 用「聚合视图引用的表不在」制造 INSERT 阶段的失败:DELETE 已经跑过,
/// 若两条各自 autocommit,此时 points_fts 就空了;包进事务则整体回滚,原索引原样保留。
/// 拿掉的是 `entity_aliases`(视图 `points_fts_src` 的自身段要读别名表)。
#[test]
fn rebuild_is_atomic_failed_rebuild_keeps_index_intact() {
    let c = db();
    let before = fts_rows(&c);
    assert_eq!(before.len() as i64, indexable_count(&c));

    c.execute("DROP TABLE entity_aliases", []).unwrap();

    assert!(rebuild(&c).is_err(), "缺表时重建必须报错,而不是静默写坏索引");
    assert_eq!(fts_rows(&c), before, "重建失败不得留下空索引(DELETE 与 INSERT 必须同一事务)");
}
