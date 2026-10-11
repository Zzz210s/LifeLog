//! T3.5 验收探针(默认忽略):在 v31 派生副本上把「建树 → 关系名 → 改名 → 删线/删点」串跑一遍给读数,
//! 跑完把新造的内容点降序删回原状(名字点已由 GC 回收),责任收尾「零残留」。
//! 用法:`LIFELOG_COPY_DB=<副本> cargo test --lib -- --ignored t35_write_serial_copy_readings --nocapture`。
//! 只碰副本;禁止写真库。对账另跑 `node scripts/entity-migration/reconcile.mjs --db <副本>`。
use crate::db::repos::tags;
use rusqlite::Connection;

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// 纯名字点数(位置判据,spec §5.2)
fn pure_name_count(c: &Connection) -> i64 {
    count(
        c,
        "SELECT COUNT(*) FROM points p
          WHERE EXISTS(SELECT 1 FROM lines n WHERE n.name_id = p.id)
            AND NOT EXISTS(SELECT 1 FROM lines t WHERE t.from_id = p.id OR t.to_id = p.id)",
    )
}

fn segs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

#[test]
#[ignore = "需要 LIFELOG_COPY_DB 指向 v31 派生副本"]
fn t35_write_serial_copy_readings() {
    let path = std::env::var("LIFELOG_COPY_DB").expect("需设 LIFELOG_COPY_DB 指向副本");
    let mut c = Connection::open(&path).unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    crate::db::sql_functions::register(&c).unwrap();

    let snapshot = |c: &Connection| {
        (
            count(c, "SELECT COUNT(*) FROM points"),
            count(c, "SELECT COUNT(*) FROM lines"),
            pure_name_count(c),
            count(c, "SELECT COUNT(*) FROM points_fts"),
        )
    };
    let before = snapshot(&c);
    let base = count(&c, "SELECT COALESCE(MAX(id), 0) FROM points");

    // 1 建树:新增 3 个内容点(区 / 甲 / 乙)+ 2 条子级线
    let a = tags::ensure_path(&c, &segs(&["T35区", "甲"])).unwrap();
    let b = tags::ensure_path(&c, &segs(&["T35区", "乙"])).unwrap();
    // 2 关系名:新增 1 个名字点 + 1 条有名线
    tags::set_tag_relation(&mut c, a, b, "T35名").unwrap();
    let nid: i64 = c
        .query_row("SELECT id FROM points WHERE meta='T35名' AND path IS NULL", [], |r| r.get(0))
        .unwrap();
    let after_rel = snapshot(&c);
    // 3 改名:线指向的名字点文本跟着变
    tags::rename_line_name(&mut c, nid, "T35名2").unwrap();
    let name_text: String = c
        .query_row(
            "SELECT COALESCE(n.meta,'') FROM lines l LEFT JOIN points n ON n.id = l.name_id WHERE l.name_id = ?1 LIMIT 1",
            rusqlite::params![nid],
            |r| r.get(0),
        )
        .unwrap();
    // 4 删线(删点由名字点 GC 承担)
    tags::remove_tag_relation(&mut c, a, b, Some(nid)).unwrap();
    let after_del = snapshot(&c);
    println!(
        "T3.5 副本串跑: 前 {before:?}(点/线/纯名/FTS) -> 挂名线后 {after_rel:?} -> 删线后 {after_del:?}; 线名字文本={name_text:?}; 新建 a={a} b={b} 名点={nid} 基准 max={base}"
    );
    assert_eq!(after_rel.2, before.2 + 1, "挂名线后纯名字点 +1");
    assert_eq!(after_rel.3, before.3 + 3, "新增 3 个树内容点各占一行,名字点不占");
    assert_eq!(after_rel.0, before.0 + 4, "新增 3 内容点 + 1 名字点");
    assert_eq!(after_del.1, before.1 + 2, "删关系线后只剩 2 条新建子级线");
    assert_eq!(after_del.0, before.0 + 3, "名字点已被 GC 回收");
    assert_eq!(after_del.2, before.2, "删线后 GC 回收名字点");

    // 清理:降序删掉新建内容点(名字点已 GC),要求回到原读数
    let ids: Vec<i64> = c
        .prepare("SELECT id FROM points WHERE id > ?1 ORDER BY id DESC")
        .unwrap()
        .query_map(rusqlite::params![base], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    for id in ids {
        c.execute(
            "DELETE FROM lines WHERE from_id=?1 OR to_id=?1 OR name_id=?1",
            rusqlite::params![id],
        )
        .unwrap();
        c.execute("DELETE FROM points WHERE id=?1", rusqlite::params![id]).unwrap();
    }
    let after_clean = snapshot(&c);
    println!("T3.5 副本清理后: {after_clean:?}");
    assert_eq!(after_clean, before, "探针必须零残留");
}
