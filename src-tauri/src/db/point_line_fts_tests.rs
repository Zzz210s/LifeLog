//! T1.3 `points_fts` / `points_fts_src` / 16 个触发器(点 / 线口径)行为读数:
//! ① 名字点仅在「非纯名字点」时有 FTS 行,线的出现 / 消失即时翻转(唯一新增刷新输入 `name_id`);
//! ② 子级线不改任何点的 `paths`(P0-6);③ `is_cited` 只被非子级线改动;
//! ④ 一致性:每行 `points_fts` == 视图直算,行集合 = 非纯名字点;
//! ⑤ 等价性:v30 `ENTITIES_AGG` 在内容点上的结果与 v31 `POINTS_AGG` 逐字节相同;
//! ⑥ 031 三个 SQL 文本不含聚合段(唯一真源在 Rust 常量)。
use super::point_line_migration_tests::v30_fixture;
use crate::db::migrate;
use crate::db::repos::entities::fts::{
    ENTITIES_AGG, MIGRATION_031_FTS_CLOSURE_SQL, MIGRATION_031_FTS_SQL, MIGRATION_031_SQL,
    NOT_PURE_NAME, POINTS_AGG,
};
use rusqlite::{params, Connection};

fn v31() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn point(c: &Connection, id: i64, meta: &str, path: Option<&str>, parent: Option<i64>, depth: Option<i64>) {
    c.execute(
        "INSERT INTO points(id, meta, is_cited, created_at, parent_id, path, depth, sort_order)
         VALUES(?1, ?2, 0, '2026-01-01', ?3, ?4, ?5, 0)",
        params![id, meta, parent, path, depth],
    )
    .unwrap();
}

fn line(c: &Connection, id: i64, from: i64, to: i64, name: Option<i64>) {
    c.execute(
        "INSERT INTO lines(id, from_id, to_id, name_id, created_at) VALUES(?1, ?2, ?3, ?4, '2026-01-01')",
        params![id, from, to, name],
    )
    .unwrap();
}

fn fts_paths(c: &Connection, id: i64) -> Option<String> {
    c.query_row("SELECT paths FROM points_fts WHERE rowid=?1", params![id], |r| r.get(0)).ok()
}

fn is_pure(c: &Connection, id: i64) -> bool {
    count(c, &format!(
        "SELECT COUNT(*) FROM points p WHERE p.id = {id}
           AND EXISTS(SELECT 1 FROM lines n WHERE n.name_id = p.id)
           AND NOT EXISTS(SELECT 1 FROM lines t WHERE t.from_id = p.id OR t.to_id = p.id)"
    )) == 1
}

/// ① 名字点:有线把它当 `name_id` 用(变纯)则退出 FTS,再作为线端点(不纯)则回来,线删掉再退出。
#[test]
fn name_point_fts_refresh_on_line_lifecycle() {
    let c = v31();
    point(&c, 1, "工作", Some("工作"), None, Some(1));
    point(&c, 2, "国籍", None, None, None);
    point(&c, 3, "笔记", None, None, None);
    assert!(fts_paths(&c, 2).is_some(), "新点 2 尚无名字位角色 -> 应进 FTS");
    line(&c, 10, 3, 1, Some(2));
    assert!(is_pure(&c, 2), "点 2 只剩 name_id 角色,应为纯名字点");
    assert!(fts_paths(&c, 2).is_none(), "纯名字点整行不进 FTS");
    line(&c, 11, 2, 1, None);
    assert!(!is_pure(&c, 2));
    assert!(fts_paths(&c, 2).is_some(), "名字点作为线端点后应回到 FTS");
    c.execute("DELETE FROM lines WHERE id = 11", []).unwrap();
    assert!(fts_paths(&c, 2).is_none(), "线消失后名字点应退出 FTS");
}

/// ①b UPDATE `lines.name_id`(线的名字位翻转):名字点进出 FTS。变异自证删除 `lines_au` 的
/// `old.name_id / new.name_id` 刷新后本用例变红。
#[test]
fn name_point_fts_refresh_on_line_rename() {
    let c = v31();
    point(&c, 1, "工作", Some("工作"), None, Some(1));
    point(&c, 2, "国籍", None, None, None);
    point(&c, 3, "笔记", None, None, None);
    line(&c, 10, 3, 1, None);
    assert!(fts_paths(&c, 2).is_some(), "点 2 尚无名字位角色 -> 应进 FTS");
    c.execute("UPDATE lines SET name_id = 2 WHERE id = 10", []).unwrap();
    assert!(is_pure(&c, 2));
    assert!(fts_paths(&c, 2).is_none(), "线改名后名字点必须退出 FTS(刷新集合含 new.name_id)");
    c.execute("UPDATE lines SET name_id = NULL WHERE id = 10", []).unwrap();
    assert!(fts_paths(&c, 2).is_some(), "线去名后名字点必须回到 FTS(刷新集合含 old.name_id)");
}

/// ② 子级线(树线)不改任何点的 `paths`(P0-6 旧口径,只换表名)。
#[test]
fn tree_line_does_not_change_paths() {
    let c = v31();
    point(&c, 1, "工作", Some("工作"), None, Some(1));
    point(&c, 2, "项目", Some("工作/项目"), Some(1), Some(2));
    point(&c, 3, "笔记", None, None, None);
    line(&c, 20, 3, 2, None);
    let before = (fts_paths(&c, 3).unwrap(), fts_paths(&c, 1).unwrap());
    line(&c, 21, 1, 2, Some(0));
    assert_eq!((fts_paths(&c, 3).unwrap(), fts_paths(&c, 1).unwrap()), before, "子级线不改 paths");
    c.execute("DELETE FROM lines WHERE id = 21", []).unwrap();
    assert_eq!((fts_paths(&c, 3).unwrap(), fts_paths(&c, 1).unwrap()), before);
}

/// ③ `is_cited` 只被非子级线改动(树线不算引用)。
#[test]
fn is_cited_follows_only_nontree_lines() {
    let c = v31();
    point(&c, 1, "工作", Some("工作"), None, Some(1));
    point(&c, 2, "项目", Some("工作/项目"), Some(1), Some(2));
    point(&c, 3, "笔记", None, None, None);
    line(&c, 30, 1, 2, Some(0));
    assert_eq!(count(&c, "SELECT is_cited FROM points WHERE id=2"), 0, "子级线不改 is_cited");
    line(&c, 31, 3, 2, None);
    assert_eq!(count(&c, "SELECT is_cited FROM points WHERE id=2"), 1, "无名线是引用");
    c.execute("DELETE FROM lines WHERE id=31", []).unwrap();
    assert_eq!(count(&c, "SELECT is_cited FROM points WHERE id=2"), 0);
}

/// ④ 一致性:行集合 = 非纯名字点,且每行与视图直算(同一 `POINTS_AGG`)逐字段相同。
#[test]
fn every_fts_row_matches_the_view_and_excludes_pure_names() {
    let c = v30_fixture("");
    migrate::run(&c).unwrap();
    let mismatch = count(
        &c,
        "SELECT COUNT(*) FROM points p
          WHERE EXISTS(SELECT 1 FROM points_fts f WHERE f.rowid = p.id) <> (NOT (EXISTS(SELECT 1 FROM lines n WHERE n.name_id = p.id) AND NOT EXISTS(SELECT 1 FROM lines t WHERE t.from_id = p.id OR t.to_id = p.id)))",
    );
    assert_eq!(mismatch, 0, "FTS 行集合必须等于非纯名字点集合");
    let diff = count(
        &c,
        "SELECT COUNT(*) FROM points_fts f JOIN points_fts_src s ON s.id = f.rowid
          WHERE f.paths <> s.paths OR f.meta <> s.meta",
    );
    assert_eq!(diff, 0, "每行必须与视图直算一致");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM points_fts"), 4, "夹具的 4 个内容点");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM points WHERE id = 0 AND EXISTS(SELECT 1 FROM lines n WHERE n.name_id = 0)"), 1);
}

/// ⑤ 等价性:v30 `ENTITIES_AGG` 与 v31 `POINTS_AGG` 在 4 个内容点上逐字节相同。
#[test]
fn v31_paths_byte_equal_v30_agg_on_content_points() {
    let c = v30_fixture("");
    crate::db::sql_functions::register(&c).unwrap();
    let old: Vec<(i64, String)> = (1..=4)
        .map(|id| {
            let s: String = c
                .query_row(&format!("SELECT {ENTITIES_AGG} FROM entities e WHERE e.id=?1"), params![id], |r| {
                    r.get(0)
                })
                .unwrap();
            (id, s)
        })
        .collect();
    migrate::run(&c).unwrap();
    for (id, before) in old {
        let after = fts_paths(&c, id).unwrap_or_else(|| panic!("v31 内容点 {id} 应有 FTS 行"));
        assert_eq!(after, before, "点 {id} 的 paths 必须与 v30 逐字节相同");
    }
}

/// ⑥ 守卫:031 的三个 SQL 文本不含聚合段;视图与 Rust 常量的每一段对得上。
#[test]
fn migration_031_has_no_aggregate_sql() {
    for (name, sql) in [
        ("031", MIGRATION_031_SQL),
        ("031_fts", MIGRATION_031_FTS_SQL),
        ("031_fts_closure", MIGRATION_031_FTS_CLOSURE_SQL),
    ] {
        assert!(!sql.contains("group_concat("), "{name} 不得内联聚合");
        assert!(!sql.contains("tag_plain("), "{name} 不得内联聚合");
    }
    assert!(MIGRATION_031_FTS_SQL.contains("points_fts_src"), "触发器与回填必须引用视图");
    assert!(MIGRATION_031_FTS_CLOSURE_SQL.contains("points_fts_src"), "闭包触发器必须引用视图");
}

#[test]
fn points_fts_src_view_matches_rust_truth() {
    let c = v31();
    let view: String = c
        .query_row("SELECT sql FROM sqlite_master WHERE type='view' AND name='points_fts_src'", [], |r| r.get(0))
        .unwrap();
    let mut segments = 0;
    for seg in POINTS_AGG.split("COALESCE(").skip(1) {
        let needle = format!("COALESCE({seg}");
        assert!(view.contains(&needle), "视图缺聚合段: {needle}");
        segments += 1;
    }
    assert!(segments >= 6, "聚合应有多段,实际 {segments}");
    assert!(view.contains(NOT_PURE_NAME), "视图的 WHERE 必须复用 NOT_PURE_NAME");
}
