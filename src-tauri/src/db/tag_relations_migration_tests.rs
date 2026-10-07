//! 迁移 022(标签关系统一)读数:一条边取代三个概念,is_type 列删除。
//! ① 新库跑到最新:无 is_type 列、tag_merge_log 建好、user_version=22
//! ② v21 升级:'type' 边并入 'tag'(同 (tag_id,target_id) 有 'tag' 行时取并集不撞主键)
//! ③ 重放幂等:'type' 边已无、再跑一次不增行
//! ④ 历史 'tag' 边(本机真实库 24 条形态)原样保留,一条不多一条不少
use super::*;

fn col_exists(conn: &Connection, table: &str, column: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
        rusqlite::params![table, column],
        |r| r.get::<_, i64>(0),
    )
    .unwrap()
        > 0
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// 与 run() 同序地迁到 21(先 001..020,再 021 的两个钩子与 SQL)
fn migrate_to_v21(c: &Connection) {
    for (i, sql) in MIGRATIONS.iter().enumerate().take(20) {
        apply(c, sql, (i + 1) as i64).unwrap();
    }
    migration_hooks::ensure_is_type_column(c).unwrap();
    migration_hooks::carry_over_role_tables(c).unwrap();
    apply(c, MIGRATIONS[20], 21).unwrap();
}

/// 造一个标签(直插 tags,不经生产写路径,保持迁移测试只依赖 SQL)
fn add_tag(c: &Connection, id: i64, path: &str) {
    c.execute(
        "INSERT INTO tags(id, name, parent_id, path, depth) VALUES(?1, ?2, NULL, ?2, 1)",
        rusqlite::params![id, path],
    )
    .unwrap();
}

#[test]
fn fresh_db_has_no_is_type_and_has_merge_log() {
    let c = Connection::open_in_memory().unwrap();
    run(&c).unwrap();
    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, latest_version());
    assert!(latest_version() >= 22, "本用例只要求跑过 022;后续迁移会继续抬升");
    assert!(!col_exists(&c, "tags", "is_type"), "022 后 is_type 列必须消失");
    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tag_merge_log'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 1, "tag_merge_log 建好(自动合并的排查日志)");
    let cols: Vec<String> = {
        let mut st = c.prepare("SELECT name FROM pragma_table_info('tag_merge_log')").unwrap();
        st.query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap()
    };
    for want in ["id", "source_tag_id", "target_tag_id", "moved_child_ids", "note_links", "edges", "at"] {
        assert!(cols.contains(&want.to_string()), "tag_merge_log 缺列 {want}: {cols:?}");
    }
}

#[test]
fn upgrade_merges_type_edges_into_tag_and_drops_is_type() {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v21(&c);
    add_tag(&c, 1, "国籍");
    add_tag(&c, 2, "中国");
    add_tag(&c, 3, "日本");
    c.execute_batch(
        "INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(2, 'type', 1);
         INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(3, 'tag', 1);",
    )
    .unwrap();

    // run() 从版本 21 续跑:022 钩子删列 + SQL 并边,再顺势跑到最新(023)
    run(&c).unwrap();

    let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, latest_version());
    assert!(!col_exists(&c, "tags", "is_type"));
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_links WHERE target_type='type'"), 0);
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM tag_links WHERE target_type='tag'"),
        2,
        "原 'type' 边并入 'tag',与既有 'tag' 边并集"
    );
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM tag_links WHERE target_type='tag' AND tag_id=2 AND target_id=1"),
        1,
        "中国 -> 国籍 的边落在 'tag'"
    );
}

#[test]
fn replay_of_022_is_idempotent_and_no_primary_key_clash() {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v21(&c);
    add_tag(&c, 1, "国籍");
    add_tag(&c, 2, "中国");
    // 同一 (tag_id,target_id) 同时存在 'tag' 与 'type' 两行:UPDATE 会撞主键,OR IGNORE 不会
    c.execute_batch(
        "INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(2, 'type', 1);
         INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(2, 'tag', 1);",
    )
    .unwrap();

    migration_hooks::drop_is_type_column(&c).unwrap();
    apply(&c, MIGRATIONS[21], 22).unwrap();
    apply(&c, MIGRATIONS[21], 22).unwrap(); // 重放

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_links WHERE target_type='type'"), 0);
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM tag_links WHERE target_type='tag'"),
        1,
        "'tag' 与 'type' 同键时取并集,重放不增行"
    );
}

#[test]
fn historical_tag_edges_are_preserved_exactly() {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v21(&c);
    for id in 100..124 {
        add_tag(&c, id, &format!("标签{id}"));
    }
    // 24 条 'tag' 边(本机真实库同一形态)
    for id in 100..124 {
        c.execute(
            "INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(?1, 'tag', 613)",
            rusqlite::params![id],
        )
        .unwrap();
    }
    let before: Vec<(i64, i64)> = {
        let mut st = c
            .prepare("SELECT tag_id, target_id FROM tag_links WHERE target_type='tag' ORDER BY tag_id")
            .unwrap();
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<Result<_, _>>().unwrap()
    };
    assert_eq!(before.len(), 24);
    add_tag(&c, 613, "地点轴/国籍");

    run(&c).unwrap();

    let after: Vec<(i64, i64)> = {
        let mut st = c
            .prepare("SELECT tag_id, target_id FROM tag_links WHERE target_type='tag' ORDER BY tag_id")
            .unwrap();
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<Result<_, _>>().unwrap()
    };
    assert_eq!(after, before, "24 条历史 'tag' 边原样保留");
}
