//! 迁移 029(统一实体 FTS 收口)读数:① v26 夹具一次跑到 29 后 `entities_fts(meta, paths)` 行数、
//! 列、回填;② 笔记实体 `paths` 与旧「`kind='note'` 分支」逐字节等价;③ 标签实体的增量逐条列出,
//! 只含「它 `link` 指向的目标段」;④ 连续两次整体重建逐行一致(不比整表字节);⑤ 028 后老物件为 0、
//! 029 装的 9 个触发器都在且不引用旧列;⑥ 029 文本不含任何聚合段(唯一真源在 Rust 常量);
//! ⑦ 视图 `entities_fts_src` 的 SQL 含 `ENTITIES_AGG` 的每一段(常量改了必须出新迁移)。
use super::entities_tags_fixture::migrated_to_v26;
use super::*;
use crate::db::repos::entities::fts::{ENTITIES_AGG, MIGRATION_029_SQL, MIGRATION_030_SQL};

/// v26 夹具(3 标签 + 2 笔记 + 7 边)一次跑到最新(30);027/028/029/030 的钩子由 `run` 负责。
fn v30() -> Connection {
    let c = migrated_to_v26();
    run(&c).unwrap();
    c
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// FTS 表里该实体的 `paths`(触发器/回填写出的实值)
fn paths(c: &Connection, id: i64) -> String {
    c.query_row("SELECT paths FROM entities_fts WHERE rowid=?1", rusqlite::params![id], |r| r.get(0))
        .unwrap()
}

/// 旧「`kind='tag'` 分支」的自身段口径(基线,不是生产代码):路径 + 纯文本 + 自身别名。
const OLD_TAG_BRANCH: &str = concat!(
    "trim(COALESCE(e.path,'') || ",
    "COALESCE(' ' || (SELECT tag_plain(e.path) WHERE tag_plain(e.path) <> e.path), '') || ",
    "COALESCE(' ' || (SELECT group_concat(a.alias,' ' ORDER BY a.alias) ",
    "FROM entity_aliases a WHERE a.entity_id = e.id), ''))"
);

fn old_tag_branch(c: &Connection, id: i64) -> String {
    c.query_row(&format!("SELECT {OLD_TAG_BRANCH} FROM entities e WHERE e.id=?1"), rusqlite::params![id], |r| {
        r.get(0)
    })
    .unwrap()
}

/// 索引快照(逐行内容,跳过 FTS5 内部字节布局)
fn dump_fts(c: &Connection) -> Vec<String> {
    let mut s = c
        .prepare("SELECT rowid||'|'||meta||'|'||paths FROM entities_fts ORDER BY rowid")
        .unwrap();
    s.query_map([], |r| r.get::<_, String>(0)).unwrap().map(|x| x.unwrap()).collect()
}

/// 与 029 末尾同一段重建(同一视图真源)
fn rebuild(c: &Connection) {
    c.execute_batch(
        "DELETE FROM entities_fts;
         INSERT INTO entities_fts(rowid, meta, paths) SELECT id, meta, paths FROM entities_fts_src;",
    )
    .unwrap();
}

/// ① 跑到 30:行数对齐、两列齐备、全库已回填
#[test]
fn upgrade_to_v30_fills_entities_fts() {
    let c = v30();
    assert_eq!(count(&c, "PRAGMA user_version"), 30);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities_fts"), count(&c, "SELECT COUNT(*) FROM entities"));
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities_fts"), 5, "2 笔记 + 3 标签");
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM pragma_table_info('entities_fts') WHERE name IN ('meta','paths')"),
        2,
        "实体 FTS 终态两列 meta / paths"
    );
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities_fts WHERE paths <> ''"), 5);
    let meta: String =
        c.query_row("SELECT meta FROM entities_fts WHERE rowid=1", [], |r| r.get(0)).unwrap();
    assert_eq!(meta, "第一条 [[第二条]]", "meta = 笔记正文");
}

/// ② 笔记实体:自身段为空,paths 与旧「kind='note' 分支」逐字节等价
#[test]
fn note_paths_are_byte_equivalent_to_the_old_branch() {
    let c = v30();
    assert_eq!(paths(&c, 1), "地点轴/中国 地点轴/日本 东瀛");
    assert_eq!(paths(&c, 2), "地点轴/日本 东瀛");
    let names: Vec<String> = {
        let mut s = c.prepare("SELECT meta FROM entities WHERE path IS NOT NULL ORDER BY id").unwrap();
        s.query_map([], |r| r.get(0)).unwrap().map(|x| x.unwrap()).collect()
    };
    assert_eq!(names, vec!["地点轴", "日本", "中国"], "id 映射:笔记在前、标签在后");
}

/// ③ 标签实体:只有「出 link 边的目标段」是增量;真库形态 = 老 relation 的条数
#[test]
fn tag_paths_gain_only_their_link_targets() {
    let c = v30();
    let diffs: Vec<(i64, String, String)> = (3..=5)
        .filter_map(|id| {
            let (old, new) = (old_tag_branch(&c, id), paths(&c, id));
            (old != new).then_some((id, old, new))
        })
        .collect();
    assert_eq!(
        diffs,
        vec![(5, "地点轴/中国".to_string(), "地点轴/中国 地点轴/日本 东瀛".to_string())],
        "只有中国额外索引了它 link 指向的日本(路径 + 目标别名)"
    );
    assert_eq!(paths(&c, 3), "地点轴", "无出链的标签自身段不变");
    assert_eq!(paths(&c, 4), "地点轴/日本 东瀛", "有别名、无出链");
    let sources_with_out_link = count(
        &c,
        "SELECT COUNT(DISTINCT l.source_id) FROM edges l JOIN entities s ON s.id = l.source_id
          WHERE l.kind='link' AND s.path IS NOT NULL",
    );
    assert_eq!(sources_with_out_link, 1, "增量条数 == 源是树内实体的 link 边条数");
}

/// ④ 重建幂等:两次重建后逐行相等
#[test]
fn rebuild_twice_is_idempotent() {
    let c = v30();
    let first = dump_fts(&c);
    rebuild(&c);
    rebuild(&c);
    assert_eq!(dump_fts(&c), first, "连续两次重建必须逐行相等");
}

/// ⑤ 老物件为 0、新 9 个触发器齐备且不引用旧列 / 旧 kind
#[test]
fn old_triggers_are_gone_and_new_nine_are_installed() {
    let c = v30();
    for name in [
        "entities_ai", "entities_ad", "entities_au", "edges_ai", "edges_ad", "edges_au",
        "entity_aliases_ai", "entity_aliases_au", "entity_aliases_ad",
    ] {
        assert_eq!(
            count(&c, &format!("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name='{name}'")),
            1,
            "缺触发器 {name}"
        );
    }
    assert_eq!(count(&c, "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger'"), 16,
        "029 的 9 个 + 030 追加的 7 个闭包刷新触发器");
    assert_eq!(
        count(
            &c,
            "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger'
              AND (sql LIKE '%tag_paths%' OR sql LIKE '%tagging%' OR sql LIKE '%relation%')"
        ),
        0,
        "不得残留引用旧列 / 旧 kind 的触发器"
    );
}

/// ⑥ 029 / 030 文本不含任何聚合段:聚合文本只由前置钩子拼视图写入
#[test]
fn migration_029_has_no_aggregate_sql() {
    assert!(!MIGRATION_029_SQL.contains("group_concat("), "029 不得内联聚合");
    assert!(!MIGRATION_029_SQL.contains("COALESCE("), "029 不得内联聚合");
    assert!(MIGRATION_029_SQL.contains("entities_fts_src"), "触发器与回填必须引用视图");
}

/// ⑥b 030 只做回填,仍不内联聚合(视图由 v30 前置钩子重建)
#[test]
fn migration_030_has_no_aggregate_sql() {
    assert!(!MIGRATION_030_SQL.contains("group_concat("), "030 不得内联聚合");
    assert!(!MIGRATION_030_SQL.contains("COALESCE("), "030 不得内联聚合");
    assert!(MIGRATION_030_SQL.contains("entities_fts_src"), "030 必须从视图回填");
}

/// ⑦ 视图 SQL 含 `ENTITIES_AGG` 的每一段(常量改了就要出新迁移重建视图)
#[test]
fn entities_fts_src_view_matches_rust_truth() {
    let c = v30();
    let view: String = c
        .query_row("SELECT sql FROM sqlite_master WHERE type='view' AND name='entities_fts_src'", [], |r| r.get(0))
        .unwrap();
    let mut segments = 0;
    for seg in ENTITIES_AGG.split("COALESCE(").skip(1) {
        let needle = format!("COALESCE({seg}");
        assert!(view.contains(&needle), "视图缺聚合段: {needle}");
        segments += 1;
    }
    assert!(segments >= 6, "聚合应有多段,实际 {segments}");
}
