//! 迁移 028 的用例(spec §7.1 步 1/3/4/6/8/9):表与边重建、id 全库重发、索引/触发器/视图收口、
//! 别名与合并日志改写、版本守卫。全部在 v27 夹具上跑,不碰真库。
use super::*;
use crate::db::repos::entities::reconcile::assert_cache_matches_edges;

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn text(c: &Connection, sql: &str) -> String {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// v27 库:`migrated_to_v26`(带 2 笔记 + 3 标签 + 7 边的夹具)再执行 027 的 SQL。
/// 027 的两个 Rust 钩子(`drop_legacy_id_column` / `rewrite_graph_positions`)与 028 无关,
/// 这里直接 `apply` 027 的 SQL 即可(028 的验证不依赖 `legacy_id` 列)。
fn v27() -> Connection {
    let c = super::entities_tags_fixture::migrated_to_v26();
    apply(&c, MIGRATIONS[26], 27).unwrap();
    c
}

/// 旧边直插(绕开老表):用于构造 028 才可能出现的同对实体多类边。
fn old_edge(c: &Connection, s: i64, t: i64, kind: &str, remark: &str) {
    c.execute(
        "INSERT INTO edges(source_id,target_id,kind,remark,created_at) \
         VALUES(?1,?2,?3,?4,'2026-01-01T00:00:00.000')",
        rusqlite::params![s, t, kind, remark],
    )
    .unwrap();
}

fn foreign_key_violations(c: &Connection) -> i64 {
    count(c, "SELECT COUNT(*) FROM pragma_foreign_key_check")
}

#[test]
fn upgrade_to_v28_is_atomic_and_passes_reconcile() {
    let c = v27();
    run(&c).unwrap();
    assert_eq!(count(&c, "PRAGMA user_version"), 28);
    assert_eq!(text(&c, "PRAGMA integrity_check"), "ok");
    assert_eq!(foreign_key_violations(&c), 0);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM sqlite_temp_master WHERE name='_id_map'"), 0);
    assert_cache_matches_edges(&c);
}

/// ② 表重建读数:实体总数不变、id 全库连号、`path` 非空数 = 老标签数、`is_cited` = 有引用类入边者。
/// 夹具里额外加一条只有 `child` 入边的根 `季节`(它不该算 `is_cited`,变异自证的靶子)。
#[test]
fn rebuild_readouts_match_legacy_counts() {
    let c = v27();
    c.execute(
        "INSERT INTO entities(id,kind,name,content,created_at,parent_id,path,depth,sort_order) \
         VALUES(1000000005,'tag','季节','','2026-01-01T00:00:00.000',NULL,'季节',1,0), \
               (1000000006,'tag','春','','2026-01-01T00:00:00.000',1000000005,'季节/春',2,0)",
        [],
    )
    .unwrap();
    old_edge(&c, 1000000005, 1000000006, "child", "");
    let old_entities = count(&c, "SELECT COUNT(*) FROM entities");
    let old_tags = count(&c, "SELECT COUNT(*) FROM entities WHERE kind='tag'");
    let old_cited = count(
        &c,
        "SELECT COUNT(*) FROM entities e WHERE EXISTS(SELECT 1 FROM edges x \
         WHERE x.target_id = e.id AND x.kind IN ('tagging','relation','link'))",
    );
    assert_eq!((old_entities, old_tags, old_cited), (7, 5, 3), "夹具基线");

    run(&c).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities"), old_entities);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL"), old_tags);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE is_cited = 1"), old_cited, "child 入边不算引用");
    let counts: (i64, i64, i64, i64) = c
        .query_row(
            "SELECT MIN(id),MAX(id),COUNT(*),COUNT(DISTINCT id) FROM entities",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    assert_eq!(counts, (1, 7, 7, 7));
    assert_eq!(text(&c, "SELECT meta FROM entities WHERE id=1"), "第一条 [[第二条]]");
    assert_eq!(text(&c, "SELECT meta FROM entities WHERE id=3"), "地点轴");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE parent_id=3"), 2, "父指针按映射改写");
}

/// ③ 边合并:老 `tagging` 与老 `link` 落在同一对实体时并成一条 `link`,`remark` 取非空者;
/// `child` 原样保留;边 id 连号。
#[test]
fn relation_and_tagging_edges_merge_into_one_link_with_remark() {
    let c = v27();
    old_edge(&c, 501, 1000000002, "link", "属性X"); // 与既有 tagging(501 -> 日本) 同对
    let old_edges = count(&c, "SELECT COUNT(*) FROM edges");
    run(&c).unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges WHERE kind='child'"), 2);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges WHERE kind='link'"), 5);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges"), old_edges - 1, "同对两条并一条");
    assert_eq!(
        text(&c, "SELECT remark FROM edges WHERE kind='link' AND source_id=1 AND target_id=4"),
        "属性X"
    );
    assert_eq!(text(&c, "SELECT remark FROM edges WHERE kind='link' AND source_id=5 AND target_id=4"), "国籍");
    let edge_ids: (i64, i64, i64) = c
        .query_row("SELECT MIN(id),MAX(id),COUNT(*) FROM edges", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .unwrap();
    assert_eq!(edge_ids, (1, 7, 7));
}

/// ④ 别名与合并日志的 id 按映射改写;日志新增 `meta_snapshot` 且历史行为空串。
#[test]
fn aliases_and_merge_log_are_remapped() {
    let c = v27();
    c.execute(
        "INSERT INTO entity_merge_log(id,source_entity_id,target_entity_id,moved_child_ids,note_links,edges,at) \
         VALUES(1,1000000003,1000000002,'[5]',3,4,'2026-01-01T00:00:00.000')",
        [],
    )
    .unwrap();
    run(&c).unwrap();
    assert_eq!(count(&c, "SELECT entity_id FROM entity_aliases WHERE alias='东瀛'"), 4);
    let log: (i64, i64, String) = c
        .query_row(
            "SELECT source_entity_id,target_entity_id,meta_snapshot FROM entity_merge_log WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(log, (5, 4, String::new()));
}

/// ⑤ 索引 / 触发器 / 视图收口:`idx_entities_path` 非唯一,老索引与 9 个老触发器、过渡视图全无。
#[test]
fn legacy_indexes_triggers_and_view_are_gone() {
    let c = v27();
    run(&c).unwrap();
    let idx = text(&c, "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_entities_path'");
    assert!(idx.starts_with("CREATE INDEX"), "必须普通索引: {idx}");
    assert!(idx.contains("WHERE path IS NOT NULL"), "必须带部分索引谓词: {idx}");
    for name in ["idx_entities_name", "idx_entities_sibling_name", "entities_fts_src"] {
        assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM sqlite_master WHERE name='{name}'")), 0, "{name} 应不存在");
    }
    // 026/027 的 9 个老触发器引用旧列(`name`/`content`/`tag_paths`)与旧 kind;本任务删净,
    // 新 9 个触发器由 Task 1.3 追加(它引用新列 `meta`/`paths`,不会被这条判据命中)。
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND (sql LIKE '%tag_paths%' OR sql LIKE '%entities_fts_src%' OR sql LIKE '%relation%')"),
        0,
        "不得残留引用旧列/旧 kind/过渡视图的触发器"
    );
}

/// ⑥ 版本守卫:已是 28 的库再跑 `run()` 不再执行 028,读数与版本不变。
#[test]
fn second_run_is_a_noop() {
    let c = v27();
    run(&c).unwrap();
    let before = (
        count(&c, "PRAGMA user_version"),
        count(&c, "SELECT COUNT(*) FROM entities"),
        count(&c, "SELECT COUNT(*) FROM edges"),
    );
    run(&c).unwrap();
    assert_eq!(
        (
            count(&c, "PRAGMA user_version"),
            count(&c, "SELECT COUNT(*) FROM entities"),
            count(&c, "SELECT COUNT(*) FROM edges"),
        ),
        before
    );
}
