//! 迁移 025(统一实体:笔记搬入 + `tagging` / `link` 边回填)核心读数。
//! 覆盖:新库到 25;v24 升级后笔记实体 id 原值 + 正文/时间逐值;`tagging` 边方向
//! (笔记 -> 标签,spec §2.1)与标签 id 偏移;`link` 边只搬已解析行(D2);老表一个字节不改;
//! 重复执行幂等;`UNIQUE(source_id,kind,target_id)` 生效。
//! 除「新库跑到最新」一例外,其余用例把库停在 v25(024/025 的读数):028 会重发全库 id,
//! 「笔记 id 保持原值」这类断言只在 v25 成立。
use super::entities_tags_fixture::{count, migrate_to_v23, seed_notes, seed_v23, table_exists};
use super::*;
use crate::db::repos::entities::TAG_ID_OFFSET;

/// v25 之前的夹具:先造 v23 老数据(3 标签 + 2 笔记 + 3 条 note 型 `tag_links`
/// + 1 条 tag 型 `relation` + 2 条 `note_links`),再落 024 把标签搬进 `entities`。
fn seeded_v24() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v23(&c);
    seed_v23(&c);
    seed_notes(&c);
    apply(&c, MIGRATIONS[23], 24).unwrap();
    c
}

/// ① 新库跑到最新:`user_version == latest_version()`(含 026),完整性 ok,无外键违规,空库笔记实体为 0
#[test]
fn fresh_run_reaches_latest_clean() {
    let c = Connection::open_in_memory().unwrap();
    run(&c).unwrap();
    assert!(latest_version() >= 26, "024/025/026 已注册");
    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, latest_version());
    assert!(table_exists(&c, "entities") && table_exists(&c, "edges"));
    assert!(table_exists(&c, "entity_aliases") && table_exists(&c, "entities_fts"), "026 建了 FTS 与别名表");
    let ok: String = c
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap();
    assert_eq!(ok, "ok");
    let mut stmt = c.prepare("PRAGMA foreign_key_check").unwrap();
    assert!(
        stmt.query([]).unwrap().next().unwrap().is_none(),
        "外键检查应为空"
    );
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NULL"), 0);
}

/// ② 笔记搬入:id 原值(spec §12 D1)、`legacy_id` 溯源、`name` 为 NULL、正文/时间逐值;
/// `entities` 总数 == 老 `notes + tags`
#[test]
fn upgrade_from_v24_brings_notes_in() {
    let c = seeded_v24();
    // 只跑到 025:028 会把老表下架并重发 id,下面的断言只在 v25 成立
    apply(&c, MIGRATIONS[24], 25).unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE kind='note'"), 2);
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM entities"),
        count(&c, "SELECT COUNT(*) FROM notes") + count(&c, "SELECT COUNT(*) FROM tags"),
        "entities 总数 == 老 notes + tags 行数"
    );
    let (id, name, content, created): (i64, Option<String>, String, String) = c
        .query_row(
            "SELECT id, name, content, created_at FROM entities WHERE id=501",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    assert_eq!(id, 501, "笔记 id 保持原值");
    assert!(name.is_none(), "笔记 name 恒 NULL");
    assert_eq!(content, "第一条 [[第二条]]");
    assert_eq!(created, "2026-01-01T00:00:00.000");
}

/// ③ `tagging` 边方向 = 笔记 -> 标签:老 `tag_links` 逐行翻转、标签端一律 ≥ 偏移、
/// 属性名恒空串
#[test]
fn tagging_edges_point_note_to_tag() {
    let c = seeded_v24();
    apply(&c, MIGRATIONS[24], 25).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges WHERE kind='tagging'"), 3);

    let from_note = |note: i64| -> Vec<i64> {
        let mut stmt = c
            .prepare(
                "SELECT target_id FROM edges WHERE kind='tagging' AND source_id=?1 ORDER BY target_id",
            )
            .unwrap();
        let rows = stmt.query_map([note], |r| r.get::<_, i64>(0)).unwrap();
        rows.map(|x| x.unwrap()).collect()
    };
    let legacy = |note: i64| -> Vec<i64> {
        let mut stmt = c
            .prepare(
                "SELECT tag_id + 1000000000 FROM tag_links \
                 WHERE target_type='note' AND target_id=?1 ORDER BY 1",
            )
            .unwrap();
        let rows = stmt.query_map([note], |r| r.get::<_, i64>(0)).unwrap();
        rows.map(|x| x.unwrap()).collect()
    };
    for note in [501_i64, 502] {
        assert_eq!(from_note(note), legacy(note), "笔记 {note} 的 tagging 目标集错");
    }
    assert_eq!(from_note(501), vec![2 + TAG_ID_OFFSET, 3 + TAG_ID_OFFSET]);
    assert_eq!(
        count(
            &c,
            &format!("SELECT COUNT(*) FROM edges WHERE kind='tagging' AND target_id < {TAG_ID_OFFSET}")
        ),
        0,
        "tagging 的标签端必须带偏移"
    );
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM edges WHERE kind='tagging' AND remark<>''"),
        0,
        "tagging 属性名恒空串"
    );
}

/// ④ `link` 边只搬已解析行(`target_id` 非空,D2 选项 A),两端 id 原值
#[test]
fn link_edges_only_include_resolved_rows() {
    let c = seeded_v24();
    apply(&c, MIGRATIONS[24], 25).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges WHERE kind='link'"), 1);
    let (src, tgt): (i64, i64) = c
        .query_row(
            "SELECT source_id, target_id FROM edges WHERE kind='link'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!((src, tgt), (501, 502));
    assert_eq!(count(&c, "SELECT COUNT(*) FROM note_links"), 2, "老表仍有 2 条 note_links");
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM note_links WHERE target_id IS NULL"),
        1,
        "其中恰 1 条未解析"
    );
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM edges WHERE kind='link' AND source_id=502"),
        0,
        "未解析行不落 link 边"
    );
}

/// ⑤ 老表零改动:025 前后 `notes` / `tag_links` / `note_links` 逐值相等(阶段 1–3 老表即真源)
#[test]
fn legacy_tables_untouched_by_025() {
    let c = seeded_v24();
    let dump = |sql: &str| -> Vec<String> {
        let mut stmt = c.prepare(sql).unwrap();
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap();
        rows.map(|x| x.unwrap()).collect()
    };
    let notes = "SELECT id||'|'||content||'|'||created_at FROM notes ORDER BY id";
    let links = "SELECT tag_id||'|'||target_type||'|'||target_id||'|'||remark \
                 FROM tag_links ORDER BY tag_id,target_type,target_id";
    let nl = "SELECT id||'|'||source_id||'|'||COALESCE(target_id,'-')||'|'||raw_title \
              FROM note_links ORDER BY id";
    let (b_notes, b_links, b_nl) = (dump(notes), dump(links), dump(nl));

    // 只应用 025 本体:老表仍在,才能逐值比对「025 未改写老表」
    apply(&c, MIGRATIONS[24], 25).unwrap();

    assert_eq!(dump(notes), b_notes, "notes 不得被 025 改写");
    assert_eq!(dump(links), b_links, "tag_links 不得被 025 改写");
    assert_eq!(dump(nl), b_nl, "note_links 不得被 025 改写");
}

/// ⑥ 崩溃重放:025 连跑两次计数不翻倍,`user_version` 仍 25
#[test]
fn replay_of_025_is_idempotent() {
    let c = seeded_v24();
    apply(&c, MIGRATIONS[24], 25).unwrap();
    apply(&c, MIGRATIONS[24], 25).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE kind='note'"), 2);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges WHERE kind='tagging'"), 3);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges WHERE kind='link'"), 1);
    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, 25);
}

/// ⑦ 唯一约束:同向同类重复边被 `UNIQUE(source_id,kind,target_id)` 拒绝
#[test]
fn duplicate_tagging_edge_is_rejected() {
    let c = seeded_v24();
    apply(&c, MIGRATIONS[24], 25).unwrap();
    let dup = c.execute(
        "INSERT INTO edges(source_id,target_id,kind,remark,created_at) \
         VALUES(501,?1,'tagging','','2026-01-01T00:00:00.000')",
        [2 + TAG_ID_OFFSET],
    );
    let msg = dup.expect_err("重复 tagging 边必须报约束错").to_string();
    assert!(
        msg.contains("UNIQUE constraint failed"),
        "应为唯一约束错,实际: {msg}"
    );
}
