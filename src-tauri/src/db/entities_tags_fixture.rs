//! 迁移 024 用例共用的 v23 夹具与查询小工具(几个测试模块共用一份,避免各写一遍)。
use super::*;

/// 024 给标签 id 加的整体偏移。只对**历史向量**(断言 024/025 时点的 id)有意义:
/// 028 重发全库 id 后偏移不再存在,故这是测试夹具常量,不是生产常量(生产已删)。
pub(crate) const LEGACY_ENTITY_ID_OFFSET: i64 = 1_000_000_000;

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

/// 停在 012 的库(逐条执行原始 SQL 并推进版本号),并把 015/019/020 的纯加表补上。
/// 013(done/doing 下架)之前的老库,供迁移 013 用例直接摆老表数据。
pub(crate) fn db_at_012() -> Connection {
    const V_012: usize = 12;
    const V_015: usize = 15;
    const V_019: usize = 19;
    const V_020: usize = 20;
    let conn = Connection::open_in_memory().unwrap();
    for (i, sql) in MIGRATIONS.iter().enumerate().take(V_012) {
        conn.execute_batch(sql).unwrap();
        conn.pragma_update(None, "user_version", (i + 1) as i64).unwrap();
    }
    conn.execute_batch(MIGRATIONS[V_015 - 1]).unwrap();
    conn.execute_batch(MIGRATIONS[V_019 - 1]).unwrap();
    conn.execute_batch(MIGRATIONS[V_020 - 1]).unwrap();
    crate::db::migration_hooks::ensure_is_type_column(&conn).unwrap();
    conn
}
