//! T3.2 验收探针(默认忽略):在 v31 派生副本上现场重算改名读数与 upsert 的查询计划。
//! 用法:`LIFELOG_COPY_DB=<副本> cargo test --lib -- --ignored t32_copy_readings --nocapture`。
//! 只碰副本;证书禁止写真库。
use super::*;
use rusqlite::Connection;

/// 纯名字点数(位置判据,spec §5.2)
fn pure_name_count(c: &Connection) -> i64 {
    c.query_row(
        "SELECT COUNT(*) FROM points p
          WHERE EXISTS(SELECT 1 FROM lines n WHERE n.name_id = p.id)
            AND NOT EXISTS(SELECT 1 FROM lines t WHERE t.from_id = p.id OR t.to_id = p.id)",
        [],
        |r| r.get(0),
    )
    .unwrap()
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// 查询计划(读第 4 列 detail;只对副本执行 EXPLAIN,不改库)
fn plan(c: &Connection, sql: &str) -> String {
    let mut stmt = c.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
    let rows: Vec<String> = stmt.query_map([], |r| r.get(3)).unwrap().map(|r| r.unwrap()).collect();
    rows.join(" | ")
}

/// upsert 字节码里出现的索引 / 表名(EXPLAIN 各行的第 6 列 p4):INSERT 的
/// `EXPLAIN QUERY PLAN` 为空,只能看字节码 —— 唯一冲突消解会看到 `Halt ... index 'idx_lines_uniq'`
/// 与 `NoConflict` / `IdxInsert`。
fn upsert_bytecode_p4(c: &Connection, sql: &str) -> Vec<String> {
    let mut stmt = c.prepare(&format!("EXPLAIN {sql}")).unwrap();
    let rows = stmt.query_map([], |r| r.get::<_, Option<String>>(5)).unwrap();
    rows.filter_map(|r| r.unwrap()).collect()
}

#[test]
#[ignore = "需要 LIFELOG_COPY_DB 指向 v31 派生副本"]
fn t32_copy_readings() {
    let path = std::env::var("LIFELOG_COPY_DB").expect("需设 LIFELOG_COPY_DB 指向副本");
    let mut c = Connection::open(&path).unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    crate::db::sql_functions::register(&c).unwrap();

    let lines_before = count(&c, "SELECT COUNT(*) FROM lines");
    let pure_before = pure_name_count(&c);
    let nid: i64 = c
        .query_row("SELECT id FROM points WHERE meta = '国籍' AND path IS NULL", [], |r| r.get(0))
        .unwrap();
    let named = count(&c, &format!("SELECT COUNT(*) FROM lines WHERE name_id = {nid}"));

    rename_line_name(&mut c, nid, "国别").unwrap();

    let lines_after = count(&c, "SELECT COUNT(*) FROM lines");
    let pure_after = pure_name_count(&c);
    let texts: Vec<String> = {
        let mut s = c
            .prepare(&format!(
                "SELECT DISTINCT COALESCE(n.meta, '') FROM lines l
                   LEFT JOIN points n ON n.id = l.name_id WHERE l.name_id = {nid}"
            ))
            .unwrap();
        s.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
    };
    println!(
        "副本读数: lines {lines_before}->{lines_after}; 引用名字点的线 {named} 条 nameText={texts:?}; 纯名字点 {pure_before}->{pure_after}"
    );
    assert_eq!(lines_before, lines_after, "改名不增删线");
    assert_eq!(pure_before, pure_after, "纯名字点数不变");
    assert_eq!(named, 24, "「国籍」引用 24 条线");
    assert_eq!(texts, vec!["国别".to_string()], "24 条线的 nameText 一起变");

    let upsert = "INSERT INTO lines(from_id, to_id, name_id, created_at)
         VALUES(1, 2, NULL, datetime('now', 'localtime'))
         ON CONFLICT(from_id, to_id, COALESCE(name_id, -1)) DO UPDATE SET name_id = excluded.name_id";
    let opened = upsert_bytecode_p4(&c, upsert);
    let update_plan = plan(
        &c,
        "UPDATE lines SET name_id = 3
          WHERE id = (SELECT id FROM lines WHERE from_id = 1 AND to_id = 2 ORDER BY id LIMIT 1)",
    );
    let hit: Vec<&String> = opened.iter().filter(|s| s.contains("idx_lines_uniq")).collect();
    println!("upsert 字节码里的 idx_lines_uniq: {hit:?}");
    println!("改名 UPDATE 计划: {update_plan}");
    assert!(!hit.is_empty(), "upsert 字节码必须用 idx_lines_uniq 消解冲突: {opened:?}");
    assert!(update_plan.contains("idx_lines_uniq"), "改名查线必须用 idx_lines_uniq: {update_plan}");
}
