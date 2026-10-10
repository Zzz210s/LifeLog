//! 031 点 / 线迁移(Task 1.2):表重建、保留名字点、线映射、表达式唯一索引与幂等。
//! 夹具是最小 v30(entities/edges + 相关表),`run()` 从 user_version = 30 只跑 031。
use super::*;

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// 4 个点 / 5 条边:child 1 条、无名 link 1 条、名前 link 3 条(国籍 2 + 状态 1)。
fn v30_fixture(extra: &str) -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch(&format!(
        "CREATE TABLE entities(
           id INTEGER PRIMARY KEY, meta TEXT NOT NULL DEFAULT '',
           is_cited INTEGER NOT NULL DEFAULT 0 CHECK(is_cited IN(0,1)),
           created_at TEXT NOT NULL, color TEXT, parent_id INTEGER, path TEXT,
           depth INTEGER, sort_order INTEGER NOT NULL DEFAULT 0);
         CREATE TABLE edges(
           id INTEGER PRIMARY KEY,
           source_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
           target_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
           kind TEXT NOT NULL CHECK(kind IN('child','link')),
           remark TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
           UNIQUE(source_id, kind, target_id));
         CREATE TABLE entity_aliases(alias TEXT PRIMARY KEY,
           entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE);
         CREATE TABLE entity_merge_log(id INTEGER PRIMARY KEY, source_entity_id INTEGER,
           target_entity_id INTEGER NOT NULL, meta_snapshot TEXT NOT NULL DEFAULT '');
         CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
         INSERT INTO entities(id, meta, is_cited, created_at, color, parent_id, path, depth, sort_order) VALUES
           (1,'工作',1,'2026-01-01',NULL,NULL,'工作',1,0),
           (2,'项目',1,'2026-01-01',NULL,1,'工作/项目',2,0),
           (3,'第一篇'||char(10)||'正文',0,'2026-01-02',NULL,NULL,NULL,NULL,0),
           (4,'地点轴',0,'2026-01-01',NULL,NULL,'地点轴',1,0);
         INSERT INTO edges(id, source_id, target_id, kind, remark, created_at) VALUES
           (1,1,2,'child','','2026-01-01T00:00:00'),
           (2,3,2,'link','','2026-01-02T00:00:00'),
           (3,4,1,'link','国籍','2026-01-03T00:00:00'),
           (4,3,1,'link','状态','2026-01-04T00:00:00'),
           (5,4,2,'link','国籍','2026-01-05T00:00:00');
         {extra}
         INSERT INTO settings(key, value) VALUES
           ('graph_positions','{{\"1\":{{\"x\":1}}}}'),
           ('ui.mru.notes','[{{\"count\":2,\"id\":\"3\"}}]');
         INSERT INTO entity_aliases(alias, entity_id) VALUES('工作别名', 1);
         PRAGMA user_version = 30;"
    ))
    .unwrap();
    c
}

fn name_of(c: &Connection, line: i64) -> String {
    c.query_row(
        "SELECT p.meta FROM lines l JOIN points p ON p.id = l.name_id WHERE l.id = ?1",
        [line],
        |r| r.get(0),
    )
    .unwrap()
}

#[test]
fn migration_031_maps_edges_and_creates_name_points() {
    let c = v30_fixture("");
    run(&c).unwrap();
    assert_eq!(count(&c, "PRAGMA user_version"), 31);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM points"), 7);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM lines"), 5);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM lines WHERE name_id = 0"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM lines WHERE name_id IS NULL"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM lines WHERE name_id IS NOT NULL AND name_id <> 0"), 3);
    assert_eq!(count(&c, "SELECT name_id FROM lines WHERE id = 1"), 0);
    assert!(c.query_row("SELECT name_id IS NULL FROM lines WHERE id = 2", [], |r| r.get::<_, bool>(0)).unwrap());
    assert_eq!(name_of(&c, 3), "国籍");
    assert_eq!(name_of(&c, 4), "状态");
    assert_eq!(name_of(&c, 5), "国籍");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM points WHERE id = 0 AND meta = '子级' AND path IS NULL AND parent_id IS NULL AND is_cited = 0"), 1);
    assert_eq!(name_of_key(&c), "0");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM lines l JOIN points p ON p.id = l.name_id WHERE p.meta = '国籍'"), 2);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM sqlite_master WHERE name IN ('entities','edges')"), 0);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM pragma_foreign_key_check"), 0);
    // 列集合与 v30 entities 一字不差(仅表名变化,spec §3.1)
    let cols: Vec<String> = c
        .prepare("SELECT name FROM pragma_table_info('points')")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(|x| x.unwrap())
        .collect();
    assert_eq!(cols, ["id", "meta", "is_cited", "created_at", "color", "parent_id", "path", "depth", "sort_order"]);
}

fn name_of_key(c: &Connection) -> String {
    c.query_row("SELECT value FROM settings WHERE key = 'tree_line_name_id'", [], |r| r.get(0)).unwrap()
}

#[test]
fn migration_031_creates_expression_unique_index() {
    let c = v30_fixture("");
    run(&c).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_lines_uniq'"), 1);
    let err = c.execute("INSERT INTO lines(id, from_id, to_id, name_id, created_at) VALUES(99,3,2,NULL,'x')", []);
    assert!(err.is_err(), "idx_lines_uniq 必须拦住重复的无名字线");
}

#[test]
fn migration_031_is_idempotent_on_replay() {
    let c = v30_fixture("");
    run(&c).unwrap();
    let before = (count(&c, "SELECT COUNT(*) FROM points"), count(&c, "SELECT COUNT(*) FROM lines"));
    c.execute_batch("PRAGMA user_version = 30;").unwrap();
    run(&c).unwrap();
    assert_eq!((count(&c, "SELECT COUNT(*) FROM points"), count(&c, "SELECT COUNT(*) FROM lines")), before);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM points WHERE id = 0"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM points WHERE meta IN ('国籍','状态')"), 2);
}

#[test]
fn migration_031_rejects_self_loop_and_rolls_back() {
    let c = v30_fixture("INSERT INTO edges(id, source_id, target_id, kind, remark, created_at) VALUES(9,1,1,'link','','2026-02-01T00:00:00');");
    assert!(run(&c).is_err(), "自指线必须让 031 因 CHECK 失败");
    assert_eq!(count(&c, "PRAGMA user_version"), 30);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities"), 4);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM sqlite_master WHERE name = 'points'"), 0);
}

#[test]
fn empty_database_replays_to_v31_with_reserved_point() {
    let c = Connection::open_in_memory().unwrap();
    run(&c).unwrap();
    assert_eq!(count(&c, "PRAGMA user_version"), latest_version());
    assert_eq!(count(&c, "SELECT COUNT(*) FROM points"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM lines"), 0);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM points WHERE id = 0 AND meta = '子级'"), 1);
}

/// 验收用(默认忽略):对真库快照副本跑一次 031。设 `LIFELOG_COPY_DB=<副本路径>` 后
/// `cargo test --lib -- --ignored migrate_snapshot_copy`。
#[test]
#[ignore = "需要 LIFELOG_COPY_DB 指向真库快照副本"]
fn migrate_snapshot_copy_from_env() {
    let path = std::env::var("LIFELOG_COPY_DB").expect("需设 LIFELOG_COPY_DB");
    let c = Connection::open(&path).unwrap();
    run(&c).unwrap();
    assert_eq!(count(&c, "PRAGMA user_version"), 31);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM pragma_foreign_key_check"), 0);
    assert_eq!(
        c.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(),
        "ok"
    );
}

#[test]
fn migration_031_preserves_point_ids_and_settings() {
    let c = v30_fixture("");
    run(&c).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM points WHERE id IN (1,2,3,4)"), 4);
    assert_eq!(
        c.query_row("SELECT value FROM settings WHERE key='ui.mru.notes'", [], |r| r.get::<_, String>(0)).unwrap(),
        "[{\"count\":2,\"id\":\"3\"}]"
    );
    assert_eq!(
        c.query_row("SELECT value FROM settings WHERE key='graph_positions'", [], |r| r.get::<_, String>(0)).unwrap(),
        "{\"1\":{\"x\":1}}"
    );
    // entity_aliases 的 FK 随 RENAME 改指 points,别名行原样存活
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entity_aliases WHERE alias = '工作别名' AND entity_id = 1"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entity_merge_log"), 0);
}
