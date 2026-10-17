//! 迁移 032(体检 2026-10-17 §2 / §4):补 `points(parent_id)` 索引 + 下架 `lines.created_at`。
//! 新库由 031 直接建成「无 `created_at`」的形态,所以必须手工造一份「v31 旧库」(带列、有数据)
//! 才能走到前置钩子的 `DROP COLUMN` —— 那正是真库升级的那条路径;顺带守住索引被规划器真的用上。
use super::*;
use rusqlite::Connection;

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn has_column(c: &Connection, table: &str, col: &str) -> bool {
    count(
        c,
        &format!("SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = '{col}'"),
    ) > 0
}

/// `lines` 的 (from_id, to_id, name_id) 快照,按 id 升序(删列前后逐值比对)
fn line_triples(c: &Connection) -> Vec<(i64, i64, Option<i64>)> {
    let mut stmt = c
        .prepare("SELECT from_id, to_id, name_id FROM lines ORDER BY id")
        .unwrap();
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
    rows.map(|r| r.unwrap()).collect()
}

fn plan_of(c: &Connection, sql: &str) -> String {
    let mut stmt = c.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
    let rows: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(3))
        .unwrap()
        .map(|x| x.unwrap())
        .collect();
    rows.join(" | ")
}

/// v31 旧库:跑到 31 后把真库当时还有的 `lines.created_at` 补回来并灌值;
/// 顺带造一条三层链(1 <- 2 <- 3)+ 300 个挂在 1 下的兄弟节点:
/// 3 行的小表规划器一律全扫,看不出索引差别。
fn v31_with_created_at() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    run_to(&c, 31).unwrap();
    c.execute_batch(
        "ALTER TABLE lines ADD COLUMN created_at TEXT NOT NULL DEFAULT '2026-01-01';
         INSERT INTO points(id, meta, created_at) VALUES
           (1,'根','2026-01-01'),(2,'子','2026-01-01'),(3,'孙','2026-01-01');
         UPDATE points SET parent_id=1, path='根',      depth=1 WHERE id=1;
         UPDATE points SET parent_id=1, path='根/子',    depth=2 WHERE id=2;
         UPDATE points SET parent_id=2, path='根/子/孙', depth=3 WHERE id=3;
         INSERT INTO lines(from_id, to_id, name_id, created_at) VALUES
           (1,2,0,'2026-01-02'),(2,3,0,'2026-01-03');",
    )
    .unwrap();
    let mut batch = String::from("BEGIN;");
    for i in 10..310 {
        batch.push_str(&format!(
            "INSERT INTO points(id, meta, created_at, parent_id, path, depth) \
             VALUES({i},'点 {i}','2026-01-01',1,'根/点{i}',2);"
        ));
    }
    batch.push_str("COMMIT;");
    c.execute_batch(&batch).unwrap();
    c
}

/// 旧库升级:列必须消失,线的三元组逐值不动,库自检干净;重放(退回 31 再跑)不报错也不改数据。
#[test]
fn migration_032_drops_line_created_at_without_touching_data() {
    let c = v31_with_created_at();
    assert!(has_column(&c, "lines", "created_at"), "前置:v31 旧库仍有 created_at");
    let before = line_triples(&c);

    run_to(&c, 32).unwrap();
    assert_eq!(count(&c, "PRAGMA user_version"), 32);
    assert!(!has_column(&c, "lines", "created_at"), "032 必须下架 lines.created_at");
    assert_eq!(line_triples(&c), before, "删列不得改 from/to/name");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM pragma_foreign_key_check"), 0);
    assert_eq!(
        c.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(),
        "ok"
    );

    // 重放:钩子按列存在性空操作,索引 `IF NOT EXISTS`,库里一个字节都不该变
    c.pragma_update(None, "user_version", 31i64).unwrap();
    run_to(&c, 32).unwrap();
    assert_eq!(count(&c, "PRAGMA user_version"), 32);
    assert_eq!(line_triples(&c), before, "重放不得改线");
}

/// `idx_points_parent` 建出来并被树递归真的用上(不再每次临时造 AUTOMATIC 索引)。
/// 查询文本与 `tags::tree::subtree_ids` 同形(体检 §2 实测的那个计划)。
#[test]
fn migration_032_creates_parent_index_that_the_planner_uses() {
    const SUBTREE: &str = "WITH RECURSIVE sub(id, depth) AS (
           SELECT id, depth FROM points WHERE id = 1
           UNION ALL
           SELECT t.id, t.depth FROM points t JOIN sub s ON t.parent_id = s.id
         ) SELECT id FROM sub ORDER BY depth DESC, id";
    let c = v31_with_created_at();
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_points_parent'"),
        0
    );
    let before = plan_of(&c, SUBTREE);
    assert!(before.to_uppercase().contains("AUTOMATIC"), "前置:旧库走临时自动索引: {before}");

    run_to(&c, 32).unwrap();
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_points_parent'"),
        1
    );
    let after = plan_of(&c, SUBTREE);
    assert!(after.contains("idx_points_parent"), "树递归必须命中真索引: {after}");
    assert!(!after.to_uppercase().contains("AUTOMATIC"), "不得再临时建自动索引: {after}");
}

/// 新库(031 已不建 `created_at`)跑到最新版:一次到位,没有中间态。
#[test]
fn fresh_db_has_no_line_created_at_and_has_parent_index() {
    let c = Connection::open_in_memory().unwrap();
    run(&c).unwrap();
    assert_eq!(count(&c, "PRAGMA user_version"), latest_version());
    assert!(!has_column(&c, "lines", "created_at"));
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_points_parent'"),
        1
    );
}
