//! 迁移 024(统一实体:建 `entities`/`edges` + 标签搬入)核心读数。
//! 覆盖:新库到 24 且完整;v23 升级后 `entities` 投影逐值等于老 `tags`(id 整体偏移、
//! `legacy_id` 溯源、树列一致);老表一个字节不改;重复执行幂等;偏移字面量与常量一致。
//! 边(`child`/`relation`)的专项读数见同目录 `entities_tags_edges_tests.rs`。
use super::entities_tags_fixture::{count, migrate_to_v23, seed_v23, table_exists};
use super::*;
use crate::db::repos::entities::TAG_ID_OFFSET;

/// 守卫用:SQL 里必须出现的偏移字面量(与 [`TAG_ID_OFFSET`] 相等)
const OFFSET_LITERAL: i64 = 1_000_000_000;

/// ① 新库跑到最新:user_version=24,表齐、完整性 ok、无外键违规
#[test]
fn fresh_run_reaches_v24_clean() {
    let c = Connection::open_in_memory().unwrap();
    run(&c).unwrap();
    super::entities_tags_fixture::legacy_read_views(&c);
    assert!(latest_version() >= 24, "本用例只要求跑过 024;后续迁移会继续抬升");
    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, latest_version(), "新库应跑到最新版本");
    assert!(table_exists(&c, "entities") && table_exists(&c, "edges"));
    let ok: String = c
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap();
    assert_eq!(ok, "ok");
    let mut stmt = c.prepare("PRAGMA foreign_key_check").unwrap();
    assert!(
        stmt.query([]).unwrap().next().unwrap().is_none(),
        "外键检查应为空"
    );
}

/// ② v23 升级:id 整体偏移、legacy_id 溯源、树列逐值正确、child 边两端正确
#[test]
fn upgrade_from_v23_maps_tag_ids_with_offset() {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v23(&c);
    seed_v23(&c);
    run(&c).unwrap();
    super::entities_tags_fixture::legacy_read_views(&c);

    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM entities WHERE kind='tag'"),
        3
    );
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges WHERE kind='child'"), 2);

    let (id, pid, path, depth): (i64, i64, String, i64) = c
        .query_row(
            "SELECT id, parent_id, path, depth FROM entities WHERE name='日本'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    assert_eq!(id, 2 + TAG_ID_OFFSET, "新标签 id 必须整体偏移");
    assert!(id >= TAG_ID_OFFSET, "新标签 id 不得落进笔记 id 区间");
    assert_eq!(pid, 1 + TAG_ID_OFFSET, "父 id 同样偏移");
    assert_eq!(path, "地点轴/日本");
    assert_eq!(depth, 2);

    let (src, tgt, remark): (i64, i64, String) = c
        .query_row(
            "SELECT source_id, target_id, remark FROM edges WHERE kind='child' AND target_id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!((src, tgt), (1 + TAG_ID_OFFSET, id));
    assert_eq!(remark, "", "child 边属性名恒空串");
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM edges WHERE kind='tagging'"),
        0,
        "笔记未搬入,不落 tagging 边"
    );
}

/// ③ 新表投影逐值等于老表(id 偏移换算;path/depth/sort_order/父指针/颜色),双向 EXCEPT 皆空
#[test]
fn entities_projection_equals_tags() {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v23(&c);
    seed_v23(&c);
    c.execute("UPDATE tags SET color='#abc' WHERE id=2", [])
        .unwrap();
    run(&c).unwrap();
    super::entities_tags_fixture::legacy_read_views(&c);

    let forward = "SELECT t.id+1000000000, t.name, t.path, t.depth, t.sort_order, \
                   COALESCE(t.parent_id+1000000000, -1), COALESCE(t.color,'') FROM tags t \
                   EXCEPT SELECT e.id, e.name, e.path, e.depth, e.sort_order, \
                   COALESCE(e.parent_id,-1), COALESCE(e.color,'') \
                   FROM entities e WHERE e.kind='tag'";
    let backward = "SELECT e.id, e.name, e.path, e.depth, e.sort_order, COALESCE(e.parent_id,-1), \
                    COALESCE(e.color,'') FROM entities e WHERE e.kind='tag' \
                    EXCEPT SELECT t.id+1000000000, t.name, t.path, t.depth, t.sort_order, \
                    COALESCE(t.parent_id+1000000000, -1), COALESCE(t.color,'') FROM tags t";
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM ({forward})")),
        0,
        "老表投影必须逐值等于新表"
    );
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM ({backward})")),
        0,
        "新表不得多出标签行"
    );
}

/// ④ 老表零改动:024 前后 tags / tag_links 逐值相等(阶段 1 老表即真源)
#[test]
fn legacy_tables_untouched_by_024() {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v23(&c);
    seed_v23(&c);
    let tags_sql = "SELECT id||'|'||name||'|'||COALESCE(parent_id,'-')||'|'||path||'|'||depth||'|'\
                    ||sort_order||'|'||COALESCE(color,'-') FROM tags ORDER BY id";
    let links_sql = "SELECT tag_id||'|'||target_type||'|'||target_id||'|'||remark \
                     FROM tag_links ORDER BY tag_id,target_type,target_id";
    let dump = |sql: &str| -> Vec<String> {
        let mut stmt = c.prepare(sql).unwrap();
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap();
        rows.map(|x| x.unwrap()).collect()
    };
    let (before_tags, before_links) = (dump(tags_sql), dump(links_sql));

    // 只应用 024 本体:老表仍在,才能逐值比对「024 未改写老表」
    apply(&c, MIGRATIONS[23], 24).unwrap();

    assert_eq!(dump(tags_sql), before_tags, "tags 不得被 024 改写");
    assert_eq!(dump(links_sql), before_links, "tag_links 不得被 024 改写");
}

/// ⑤ 崩溃重放:024 连跑两次不炸,计数不翻倍
#[test]
fn replay_of_024_is_idempotent() {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v23(&c);
    seed_v23(&c);
    apply(&c, MIGRATIONS[23], 24).unwrap();
    apply(&c, MIGRATIONS[23], 24).unwrap();
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM entities WHERE kind='tag'"),
        3
    );
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges WHERE kind='child'"), 2);
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM edges WHERE kind='relation'"),
        1
    );
    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, 24);
}

/// ⑥ 守卫:024 里的偏移字面量 == `TAG_ID_OFFSET`(改常量不改 SQL = 悄悄写错 id 区间)
#[test]
fn offset_literal_matches_const() {
    let sql = MIGRATIONS[23];
    assert!(
        sql.contains(&OFFSET_LITERAL.to_string()),
        "024 必须出现偏移字面量 {OFFSET_LITERAL}"
    );
    assert_eq!(TAG_ID_OFFSET, OFFSET_LITERAL, "常量真源与迁移字面量必须一致");
}
