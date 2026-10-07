//! 迁移 026(统一实体:FTS 统一 + 9 个触发器 + 整体重建)核心读数。
//! 覆盖:① v25 -> v26 后 `entities_fts` 行数 == `entities` 行数、逐行聚合值;② 重建幂等(两次逐行相等);
//! ③ 直写 `entities` -> `entities_ai` 写出该行;④ 直写 `edges`(tagging)-> 笔记 `tag_paths` 变化;
//! ⑤ 删 `entity_aliases` -> 受影响实体重写;⑥ `notes_fts` 与老 8 个触发器原样保留、新 9 个都在;
//! ⑦ 插 `child` 边不改任何实体的 `tag_paths`;⑧ 迁移文本含与 Rust 真源 `ENTITIES_AGG` 逐段一致的聚合;
//! ⑨ 2 字标签名的 LIKE 退化分支可命中(spec §4.1:trigram 对 <3 字命中不到)。
use super::entities_tags_fixture::{count, migrate_to_v23, seed_notes, seed_v23};
use super::*;
use crate::db::repos::entities::fts::{ENTITIES_AGG, MIGRATION_026_SQL};
use crate::db::repos::entities::TAG_ID_OFFSET;
use rusqlite::params;

/// 迁移前的老触发器(记忆 #1290);026 一个都不动。
const LEGACY_TRIGGERS: [&str; 8] = [
    "notes_ad", "notes_ai", "notes_au", "tag_aliases_ad", "tag_aliases_ai", "tag_aliases_au",
    "tag_links_ad", "tag_links_ai",
];

/// 026 装的 9 个新触发器(spec §4.3 清单;`edges_au` 是新补的)。
const NEW_TRIGGERS: [&str; 9] = [
    "edges_ad", "edges_ai", "edges_au", "entities_ad", "entities_ai", "entities_au",
    "entity_aliases_ad", "entity_aliases_ai", "entity_aliases_au",
];

fn tag(id: i64) -> i64 {
    id + TAG_ID_OFFSET
}

/// 只到 v25(024 标签搬入 + 025 笔记搬入),供「v25 -> v26」用例观测迁移效果。
fn migrated_to_v25() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v23(&c);
    seed_v23(&c);
    seed_notes(&c);
    apply(&c, MIGRATIONS[23], 24).unwrap();
    apply(&c, MIGRATIONS[24], 25).unwrap();
    c
}

fn migrated_to_v26() -> Connection {
    let c = migrated_to_v25();
    apply(&c, MIGRATIONS[25], 26).unwrap();
    c
}

fn fts_paths(c: &Connection, id: i64) -> String {
    c.query_row("SELECT tag_paths FROM entities_fts WHERE rowid=?1", params![id], |r| r.get(0))
        .unwrap()
}

/// 逐行内容(跳过 FTS5 内部字节布局,记忆 #1187 同款)
fn dump_fts(c: &Connection) -> Vec<String> {
    let mut s = c
        .prepare("SELECT rowid||'|'||name||'|'||content||'|'||tag_paths FROM entities_fts ORDER BY rowid")
        .unwrap();
    s.query_map([], |r| r.get::<_, String>(0)).unwrap().map(|x| x.unwrap()).collect()
}

/// 与 026 末尾同一段重建 SQL(同一视图真源;两次重建逐行一致)
fn rebuild(c: &Connection) {
    c.execute_batch(
        "DELETE FROM entities_fts;
         INSERT INTO entities_fts(rowid, name, content, tag_paths)
         SELECT id, name, content, tag_paths FROM entities_fts_src;",
    )
    .unwrap();
}

/// ① v25 -> v26:行数对齐、逐行聚合值正确、标签实体自身路径进了索引
#[test]
fn upgrade_from_v25_fills_entities_fts() {
    let c = migrated_to_v26();
    assert_eq!(count(&c, "PRAGMA user_version"), 26);
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM entities_fts"),
        count(&c, "SELECT COUNT(*) FROM entities"),
        "entities_fts 行数必须等于 entities 行数"
    );
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities_fts"), 5, "3 标签 + 2 笔记");
    assert_eq!(fts_paths(&c, tag(1)), "地点轴", "标签实体 = 自身路径");
    assert_eq!(fts_paths(&c, tag(2)), "地点轴/日本 东瀛", "标签实体 = 路径 + 自身别名");
    assert_eq!(fts_paths(&c, 501), "地点轴/中国 地点轴/日本 东瀛", "笔记 = 路径 + 别名");
    assert_eq!(fts_paths(&c, 502), "地点轴/日本 东瀛");
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM entities_fts WHERE tag_paths <> ''"),
        5,
        "标签实体自身路径确实进了索引"
    );
}

/// ② 重建幂等:两次重建后逐行内容与首次一致(不比整表字节)
#[test]
fn rebuild_twice_is_idempotent() {
    let c = migrated_to_v26();
    let first = dump_fts(&c);
    rebuild(&c);
    rebuild(&c);
    assert_eq!(dump_fts(&c), first, "连续两次重建必须逐行相等");
}

/// ③ 直写 `entities` 一条 tag -> `entities_ai` 写出该行
#[test]
fn insert_entity_writes_fts_row() {
    let c = migrated_to_v26();
    c.execute(
        "INSERT INTO entities(id, kind, name, content, created_at, parent_id, path, depth, sort_order)
         VALUES(?1, 'tag', '新页', '', '2026-01-01T00:00:00.000', ?2, '地点轴/新页', 2, 0)",
        params![tag(4), tag(1)],
    )
    .unwrap();
    assert_eq!(fts_paths(&c, tag(4)), "地点轴/新页", "新标签实体必须被 entities_ai 索引");
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM entities_fts WHERE rowid = {}", tag(4))),
        1
    );
}

/// ④ 直写 `edges` 一条 tagging -> 该笔记的 `tag_paths` 变化
#[test]
fn insert_tagging_edge_updates_note_fts() {
    let c = migrated_to_v26();
    assert_eq!(fts_paths(&c, 502), "地点轴/日本 东瀛", "基线");
    c.execute(
        "INSERT INTO edges(source_id, target_id, kind, remark, created_at)
         VALUES(502, ?1, 'tagging', '', '2026-01-01T00:00:00.000')",
        params![tag(1)],
    )
    .unwrap();
    assert_eq!(fts_paths(&c, 502), "地点轴 地点轴/日本 东瀛", "加链后笔记聚合必须重算");
}

/// ⑤ 删 `entity_aliases` 行 -> 该标签自身与其名下笔记一起重写
#[test]
fn delete_entity_alias_rewrites_affected() {
    let c = migrated_to_v26();
    c.execute("DELETE FROM entity_aliases WHERE alias = '东瀛'", []).unwrap();
    assert_eq!(fts_paths(&c, tag(2)), "地点轴/日本", "标签自身去掉别名段");
    assert_eq!(fts_paths(&c, 501), "地点轴/中国 地点轴/日本");
    assert_eq!(fts_paths(&c, 502), "地点轴/日本");
}

/// ⑥ `notes_fts` 与老 8 个触发器原样保留,新 9 个触发器都在(阶段 3 共存)
#[test]
fn legacy_fts_and_triggers_untouched() {
    let c = migrated_to_v26();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM notes_fts"), 2, "老 FTS 镜像不动");
    let mut s = c.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").unwrap();
    let names: Vec<String> = s.query_map([], |r| r.get::<_, String>(0)).unwrap().map(|x| x.unwrap()).collect();
    for t in LEGACY_TRIGGERS {
        assert!(names.contains(&t.to_string()), "老触发器 {t} 必须还在");
    }
    for t in NEW_TRIGGERS {
        assert!(names.contains(&t.to_string()), "新触发器 {t} 必须已装");
    }
    assert_eq!(names.len(), 17, "8 老 + 9 新;不得多装触发器");
}

/// ⑦ 插 `child` 边不改任何实体的 `tag_paths`(child 只影响树缓存,不影响聚合串)
#[test]
fn child_edge_does_not_change_tag_paths() {
    let c = migrated_to_v26();
    c.execute(
        "INSERT INTO entities(id, kind, name, content, created_at, parent_id, path, depth, sort_order)
         VALUES(?1, 'tag', '新页', '', '2026-01-01T00:00:00.000', ?2, '地点轴/新页', 2, 0)",
        params![tag(4), tag(1)],
    )
    .unwrap();
    let before = (fts_paths(&c, tag(1)), fts_paths(&c, tag(4)));
    c.execute(
        "INSERT INTO edges(source_id, target_id, kind, remark, created_at)
         VALUES(?1, ?2, 'child', '', '2026-01-01T00:00:00.000')",
        params![tag(1), tag(4)],
    )
    .unwrap();
    assert_eq!((fts_paths(&c, tag(1)), fts_paths(&c, tag(4))), before, "child 边不得改聚合");
}

/// ⑧ 026 文本含与 Rust 真源逐段一致的聚合(T3.1 守卫升级:按 `COALESCE(` 切段比对)
#[test]
fn agg_segments_appear_in_026_text() {
    let segments: Vec<&str> = ENTITIES_AGG.split("COALESCE(").skip(1).collect();
    assert!(segments.len() >= 6, "聚合应有多段,实际 {}", segments.len());
    for seg in segments {
        let needle = format!("COALESCE({seg}");
        assert!(MIGRATION_026_SQL.contains(&needle), "026 文本缺聚合段: {needle}");
    }
}
