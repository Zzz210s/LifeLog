//! T1.3 阶段 1 收口:阶段 1 结束时「应用(老读方)照常跑」与「新表投影 == 老表」的逐值证据。
//! T1.1 已有一条核心投影用例(`entities_tags_migration_tests::entities_projection_equals_tags`);
//! 本文件用「偏移减法」形式复算双向 EXCEPT,并补齐老读方三项读数:老表全列摘要不变、
//! 标签树面板数据源 `tags::counts` 读数不变、触发器集合仍是 8 个老名字且 `notes`/`note_links`
//! 列集合未被 024 添加新列。真库副本上的读数见 `scripts/entity-migration/phase1-smoke.mjs`。
use super::entities_tags_fixture::{add_tag, count, migrate_to_v23, seed_v23};
use super::*;

/// 迁移前的老触发器集合(记忆 #1290),按名字升序;024 只增新表,不得动任何一个
const LEGACY_TRIGGERS: [&str; 8] = [
    "notes_ad",
    "notes_ai",
    "notes_au",
    "tag_aliases_ad",
    "tag_aliases_ai",
    "tag_aliases_au",
    "tag_links_ad",
    "tag_links_ai",
];

/// 表列集合(`name:type`,按 cid 序):断言 024 没给老表加列
fn columns(c: &Connection, table: &str) -> Vec<String> {
    let mut stmt = c
        .prepare(&format!(
            "SELECT name || ':' || type FROM pragma_table_info('{table}') ORDER BY cid"
        ))
        .unwrap();
    stmt.query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .map(|x| x.unwrap())
        .collect()
}

/// 单列行摘要(排序后逐行取第 1 列):比较迁移前后是否一字不差
fn dump(c: &Connection, sql: &str) -> Vec<String> {
    let mut stmt = c.prepare(sql).unwrap();
    stmt.query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .map(|x| x.unwrap())
        .collect()
}

/// 老读方会读到的五张老表的全列行摘要;024 前后必须逐值一致
fn legacy_digest(c: &Connection) -> Vec<String> {
    let mut out = dump(
        c,
        "SELECT id||'|'||name||'|'||COALESCE(parent_id,'-')||'|'||path||'|'||depth||'|'\
         ||sort_order||'|'||COALESCE(color,'-') FROM tags ORDER BY id",
    );
    out.extend(dump(
        c,
        "SELECT tag_id||'|'||target_type||'|'||target_id||'|'||remark FROM tag_links \
         ORDER BY tag_id, target_type, target_id",
    ));
    out.extend(dump(
        c,
        "SELECT id||'|'||content||'|'||created_at FROM notes ORDER BY id",
    ));
    out.extend(dump(
        c,
        "SELECT rowid||'|'||content||'|'||tags FROM notes_fts ORDER BY rowid",
    ));
    out.extend(dump(
        c,
        "SELECT alias||'|'||tag_id FROM tag_aliases ORDER BY alias",
    ));
    out
}

/// 两条笔记:让 notes / notes_fts 在迁移前就有真实行,`notes_au` 聚合口径得以被摘要覆盖
fn seed_two_notes(c: &Connection) {
    c.execute(
        "INSERT INTO notes(id, content) VALUES(501, '第一篇 #地点轴/日本')",
        [],
    )
    .unwrap();
    c.execute(
        "INSERT INTO notes(id, content) VALUES(502, '第二篇 关于中国')",
        [],
    )
    .unwrap();
}

/// ① 投影等价:双向 EXCEPT 皆空(id/name/path/depth/sort_order/parent_id 逐值,差异行数 0)
#[test]
fn entities_projection_equals_tags_with_offset() {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v23(&c);
    seed_v23(&c);
    add_tag(&c, 4, "东海", Some(2), "地点轴/日本/东海", 3);
    c.execute("UPDATE tags SET color='#abc' WHERE id=2", []).unwrap();
    run(&c).unwrap();

    let forward = "SELECT t.id, t.name, t.path, t.depth, t.sort_order, t.parent_id FROM tags t \
                   EXCEPT SELECT e.id - 1000000000, e.name, e.path, e.depth, e.sort_order, \
                   e.parent_id - 1000000000 FROM entities e WHERE e.kind='tag'";
    let backward = "SELECT e.id - 1000000000, e.name, e.path, e.depth, e.sort_order, \
                    e.parent_id - 1000000000 FROM entities e WHERE e.kind='tag' \
                    EXCEPT SELECT t.id, t.name, t.path, t.depth, t.sort_order, t.parent_id \
                    FROM tags t";
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags"), 4, "夹具非空,避免两边同空假绿");
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM ({forward})")),
        0,
        "老表 -> 新表 必须无差异行"
    );
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM ({backward})")),
        0,
        "新表 -> 老表 必须无差异行"
    );
}

/// ② 老表零改动:五张老表全列摘要逐值不变(阶段 1 老表即真源,P0-a)
#[test]
fn legacy_tables_digest_unchanged_by_024() {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v23(&c);
    seed_v23(&c);
    seed_two_notes(&c);
    let before = legacy_digest(&c);
    assert!(before.len() >= 8, "夹具应有足够的行被摘要覆盖");
    run(&c).unwrap();
    assert_eq!(legacy_digest(&c), before, "024 不得改写任何老表行");
}

/// ③ 老读方 smoke:`tags::counts`(标签树面板数据源)在 v24 上读数与迁移前逐值相同
#[test]
fn tag_tree_readings_unchanged_by_024() {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v23(&c);
    seed_v23(&c);
    seed_two_notes(&c);
    let before = crate::db::repos::tags::counts(&c).unwrap();
    assert_eq!(before.len(), 3, "夹具应有 3 个标签读数");
    run(&c).unwrap();
    assert_eq!(
        crate::db::repos::tags::counts(&c).unwrap(),
        before,
        "标签树读数必须逐值不变"
    );
}

/// ④ 形状不变:触发器仍是 8 个老名字,`notes`/`note_links` 列集合未被 024 添加新列
#[test]
fn legacy_triggers_and_columns_unchanged_by_024() {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v23(&c);
    seed_v23(&c);
    seed_two_notes(&c);
    let triggers_sql = "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name";
    let before = (
        dump(&c, triggers_sql),
        columns(&c, "notes"),
        columns(&c, "note_links"),
    );
    run(&c).unwrap();
    let after = (
        dump(&c, triggers_sql),
        columns(&c, "notes"),
        columns(&c, "note_links"),
    );
    assert_eq!(after, before, "024 不得增删触发器或改老表列");
    assert_eq!(
        after.0,
        LEGACY_TRIGGERS.map(String::from),
        "触发器集合仍是 8 个老名字"
    );
}
