//! 迁移 024 用例共用的 v23 夹具与查询小工具(几个测试模块共用一份,避免各写一遍)。
use super::*;

pub(crate) fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

pub(crate) fn table_exists(conn: &Connection, name: &str) -> bool {
    count(
        conn,
        &format!("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='{name}'"),
    ) > 0
}

/// 与 `run()` 同序迁到 23(001..020 + 021/022/023 各自的钩子)
pub(crate) fn migrate_to_v23(c: &Connection) {
    for (i, sql) in MIGRATIONS.iter().enumerate().take(20) {
        apply(c, sql, (i + 1) as i64).unwrap();
    }
    migration_hooks::ensure_is_type_column(c).unwrap();
    migration_hooks::carry_over_role_tables(c).unwrap();
    apply(c, MIGRATIONS[20], 21).unwrap();
    migration_hooks::drop_is_type_column(c).unwrap();
    apply(c, MIGRATIONS[21], 22).unwrap();
    migration_hooks::ensure_link_remark_column(c).unwrap();
    apply(c, MIGRATIONS[22], 23).unwrap();
}

pub(crate) fn add_tag(c: &Connection, id: i64, name: &str, parent: Option<i64>, path: &str, depth: i64) {
    c.execute(
        "INSERT INTO tags(id, name, parent_id, path, depth, sort_order) VALUES(?1,?2,?3,?4,?5,0)",
        rusqlite::params![id, name, parent, path, depth],
    )
    .unwrap();
}

/// 1 根 + 2 子;1 条 note 型链接(笔记未搬入,不落边)、1 条 tag 型链接(relation,带属性名)、1 条别名
pub(crate) fn seed_v23(c: &Connection) {
    add_tag(c, 1, "地点轴", None, "地点轴", 1);
    add_tag(c, 2, "日本", Some(1), "地点轴/日本", 2);
    add_tag(c, 3, "中国", Some(1), "地点轴/中国", 2);
    c.execute(
        "INSERT INTO tag_links(tag_id,target_type,target_id,remark) VALUES(2,'note',501,'')",
        [],
    )
    .unwrap();
    c.execute(
        "INSERT INTO tag_links(tag_id,target_type,target_id,remark) VALUES(3,'tag',2,'国籍')",
        [],
    )
    .unwrap();
    c.execute("INSERT INTO tag_aliases(alias,tag_id) VALUES('东瀛',2)", [])
        .unwrap();
}

/// 025 用的笔记夹具:2 条笔记 + 2 条额外 note 型 `tag_links`(`seed_v23` 已有 501→标签2)
/// + 2 条 `note_links`(501→502 已解析、502→NULL 未解析)。正文含 `[[ ]]` 便于阶段 4 重解析。
pub(crate) fn seed_notes(c: &Connection) {
    c.execute(
        "INSERT INTO notes(id, content, created_at) \
         VALUES(501,'第一条 [[第二条]]','2026-01-01T00:00:00.000')",
        [],
    )
    .unwrap();
    c.execute(
        "INSERT INTO notes(id, content, created_at) VALUES(502,'第二条','2026-01-02T00:00:00.000')",
        [],
    )
    .unwrap();
    c.execute(
        "INSERT INTO tag_links(tag_id,target_type,target_id,remark) VALUES(3,'note',501,'')",
        [],
    )
    .unwrap();
    c.execute(
        "INSERT INTO tag_links(tag_id,target_type,target_id,remark) VALUES(2,'note',502,'')",
        [],
    )
    .unwrap();
    c.execute(
        "INSERT INTO note_links(source_id,target_id,raw_title,created_at) \
         VALUES(501,502,'第二条','2026-01-01T00:00:00.000')",
        [],
    )
    .unwrap();
    c.execute(
        "INSERT INTO note_links(source_id,target_id,raw_title,created_at) \
         VALUES(502,NULL,'未解析','2026-01-02T00:00:00.000')",
        [],
    )
    .unwrap();
}

/// 阶段 4(027)后老表已下架,但历史迁移用例仍在用老表名与**老标签 id** 做只读断言。
/// 本帮手把它们建成投影新表的只读视图(幂等):标签 id 减回偏移,老用例的比较逐值仍成立。
pub(crate) fn legacy_read_views(c: &Connection) {
    c.execute_batch(
        "DROP VIEW IF EXISTS notes;
         DROP VIEW IF EXISTS tags;
         DROP VIEW IF EXISTS tag_links;
         DROP VIEW IF EXISTS tag_merge_log;
         DROP VIEW IF EXISTS note_links;
         CREATE VIEW notes AS
           SELECT id, content, created_at FROM entities WHERE kind = 'note';
         CREATE VIEW tags AS
           SELECT id - 1000000000 AS id, name, parent_id - 1000000000 AS parent_id,
                  path, depth, sort_order, color
           FROM entities WHERE kind = 'tag';
         CREATE VIEW tag_links AS
           SELECT target_id - 1000000000 AS tag_id, 'note' AS target_type,
                  source_id AS target_id, remark
             FROM edges WHERE kind = 'tagging'
           UNION ALL
           SELECT source_id - 1000000000 AS tag_id, 'tag' AS target_type,
                  target_id - 1000000000 AS target_id, remark
             FROM edges WHERE kind = 'relation';
         CREATE VIEW tag_merge_log AS
           SELECT id, source_entity_id - 1000000000 AS source_tag_id,
                  target_entity_id - 1000000000 AS target_tag_id,
                  moved_child_ids, note_links, edges, at
           FROM entity_merge_log;
         CREATE VIEW note_links AS
           SELECT id, source_id, target_id, '' AS raw_title, created_at
           FROM edges WHERE kind = 'link';",
    )
    .unwrap();
}

/// 024/025/026 全跑完的 v26 库(027 用例的起点;此时老表仍是真源、新表已投影)
pub(crate) fn migrated_to_v26() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v23(&c);
    seed_v23(&c);
    seed_notes(&c);
    apply(&c, MIGRATIONS[23], 24).unwrap();
    apply(&c, MIGRATIONS[24], 25).unwrap();
    apply(&c, MIGRATIONS[25], 26).unwrap();
    c
}
