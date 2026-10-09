//! T3.1 / T1.3 `ENTITIES_AGG`(统一口径唯一真源)行为读数 + 9 个触发器的增量刷新。
//! ① 笔记实体 = 出 `link` 边目标的路径 + 纯文本 + 目标别名(自身段为空,与旧笔记分支逐字节等价);
//! ② 标签实体 = 自身完整路径 + 纯文本 + 自身别名 + 出 `link` 边目标段(新增量);
//! ③ `refresh_entities_fts` 写出的行 == `ENTITIES_AGG` 直算的行 == 视图直算;
//! ④ 直写 `entities` / `edges(kind='link')` / `entity_aliases` 各触发正确刷新;
//!    插 `child` 边不改任何实体的 `paths`(P0-6);
//! ⑤ `is_cited` 随 `link` 边增删增量维护。
use crate::db::migrate;
use crate::db::repos::entities::fts::ENTITIES_AGG;
use crate::db::repos::tags::invariants_tests::{assert_fts_matches_edges, assert_is_cited_matches_edges};
use crate::db::repos::tags::tree::refresh_entities_fts;
use rusqlite::{params, Connection};

/// 某实体的聚合串(直算,不经 FTS 表)
fn agg(c: &Connection, id: i64) -> String {
    c.query_row(&format!("SELECT {ENTITIES_AGG} FROM entities e WHERE e.id = ?1"), params![id], |r| {
        r.get(0)
    })
    .unwrap()
}

/// FTS 表里该实体的 `paths`(触发器写出的实值)
fn paths(c: &Connection, id: i64) -> String {
    c.query_row("SELECT paths FROM entities_fts WHERE rowid = ?1", params![id], |r| r.get(0)).unwrap()
}

/// 小库(直接摆新表,`migrate::run` 之后):3 个标签 + 2 条笔记 + 3 条 `link` 边 + 3 个别名。
/// 标签 4 带行内 md,标签 5 -> 6 是标签间 `link`(老 `relation`),笔记只链标签。
fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c.execute_batch(
        "INSERT INTO entities(id,meta,created_at,path,depth) VALUES
           (1,'正文','2026-01-01',NULL,NULL),
           (2,'第二条','2026-01-01',NULL,NULL),
           (3,'地点','2026-01-01','地点',1),
           (4,'[郴](chēn)州市','2026-01-01','地点/[郴](chēn)州市',2),
           (5,'生活','2026-01-01','生活',1),
           (6,'目标','2026-01-01','目标',1);
         INSERT INTO edges(source_id,target_id,kind,created_at) VALUES
           (1,3,'link','2026-01-01'),(1,4,'link','2026-01-01'),(5,6,'link','2026-01-01');
         INSERT INTO entity_aliases(alias,entity_id) VALUES
           ('地方',3),('郴',4),('目标别名',6);",
    )
    .unwrap();
    c
}

/// ① 笔记实体:自身段为空,只有出链目标的路径 + 纯文本路径 + 目标别名(按各自 ORDER BY 排序)
#[test]
fn note_entity_aggregates_only_its_link_targets() {
    let c = db();
    assert_eq!(agg(&c, 1), "地点 地点/[郴](chēn)州市 地点/郴州市 地方 郴");
    assert_eq!(agg(&c, 2), "", "无出链的笔记 paths 为空串");
}

/// ② 标签实体:自身段(路径 + 纯文本 + 别名)在前,出 `link` 边目标段在后
#[test]
fn tag_entity_keeps_own_segment_then_gains_targets() {
    let c = db();
    assert_eq!(agg(&c, 3), "地点 地方", "有别名、无出链");
    assert_eq!(agg(&c, 4), "地点/[郴](chēn)州市 地点/郴州市 郴", "自身段含纯文本形态");
    assert_eq!(agg(&c, 5), "生活 目标 目标别名", "标签间 link:自身路径 + 目标路径 + 目标别名");
    assert_eq!(agg(&c, 6), "目标 目标别名");
}

/// ③ 显式重写写出的行 == 直算;`meta` 也按实体口径落库
#[test]
fn refresh_entities_fts_matches_the_direct_aggregate() {
    let c = db();
    let ids = [1, 2, 3, 4, 5, 6];
    refresh_entities_fts(&c, &ids).unwrap();
    let rows: Vec<(i64, String, String)> = {
        let mut stmt = c
            .prepare("SELECT rowid, meta, paths FROM entities_fts ORDER BY rowid")
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    };
    assert_eq!(rows.len(), ids.len());
    for (id, meta, fts_paths) in rows {
        let want_meta: String =
            c.query_row("SELECT e.meta FROM entities e WHERE e.id = ?1", params![id], |r| r.get(0)).unwrap();
        assert_eq!(meta, want_meta, "实体 {id} 的 meta");
        assert_eq!(fts_paths, agg(&c, id), "实体 {id} 的 paths 必须 == ENTITIES_AGG 直算");
    }
    assert_fts_matches_edges(&c);
    assert_is_cited_matches_edges(&c);
}

/// ④a 直插实体 -> `entities_ai` 写行;直插 `link` 边 -> 来源重算、目标不变
#[test]
fn insert_entity_and_link_edge_refresh_fts() {
    let c = db();
    c.execute(
        "INSERT INTO entities(id,meta,created_at,path,depth) VALUES(7,'新页','2026-01-01','新页',1)",
        [],
    )
    .unwrap();
    assert_eq!(paths(&c, 7), "新页", "entities_ai 必须写出新实体");
    let target_before = paths(&c, 6);
    c.execute(
        "INSERT INTO edges(source_id,target_id,kind,created_at) VALUES(7,6,'link','2026-01-01')",
        [],
    )
    .unwrap();
    assert_eq!(paths(&c, 7), "新页 目标 目标别名", "来源的引用段必须补上目标路径与目标别名");
    assert_eq!(paths(&c, 6), target_before, "目标的自身段不因入链改变");
    assert_fts_matches_edges(&c);
}

/// ④b 删别名 -> 标签自身与其引用源一起重写
#[test]
fn delete_entity_alias_refreshes_entity_and_sources() {
    let c = db();
    c.execute("DELETE FROM entity_aliases WHERE alias = '地方'", []).unwrap();
    assert_eq!(paths(&c, 3), "地点");
    assert_eq!(paths(&c, 1), "地点 地点/[郴](chēn)州市 地点/郴州市 郴");
    assert_fts_matches_edges(&c);
}

/// ④c P0-6:插 `child` 边不改变父 / 子实体的 `paths`(path 缓存由写路径同事务维护)
#[test]
fn child_edge_does_not_touch_fts() {
    let c = db();
    let before = (paths(&c, 3), paths(&c, 4));
    c.execute(
        "INSERT INTO edges(source_id,target_id,kind,created_at) VALUES(3,4,'child','2026-01-01')",
        [],
    )
    .unwrap();
    assert_eq!((paths(&c, 3), paths(&c, 4)), before, "child 边不得改 paths");
    assert_fts_matches_edges(&c);
}

/// ⑤ `is_cited` 增量:插 `link` 边把目标置 1,删掉后回 0(与对账同口径)
#[test]
fn is_cited_follows_link_edges_incrementally() {
    let c = db();
    let cited = |id: i64| c.query_row("SELECT is_cited FROM entities WHERE id=?1", params![id], |r| {
        r.get::<_, i64>(0)
    }).unwrap();
    assert_eq!(cited(2), 0, "无入链");
    c.execute("INSERT INTO edges(source_id,target_id,kind,created_at) VALUES(1,2,'link','2026-01-01')", []).unwrap();
    assert_eq!(cited(2), 1);
    c.execute("DELETE FROM edges WHERE source_id=1 AND target_id=2 AND kind='link'", []).unwrap();
    assert_eq!(cited(2), 0);
    assert_is_cited_matches_edges(&c);
}
