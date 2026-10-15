//! 真库**副本**上的名线往返无损(T3 验收;设计 §6.3):把每条名线的来源点读成 `TagLine`
//! (目标路径 + 名字文本,名字只从 `name_id` 指向的名字点 `meta` 逐字节读出),再走真实
//! 写线语义写回,断言线 id 与 `name_id` 逐条不变、库的行数一个不差。
//! 跑法:`LIFELOG_SNAPSHOT_DB=<snapshot.mjs 制的副本> cargo test --lib -- --ignored roundtrip`
//! 只写副本(真库一律 `mode=ro`);副本用 `scripts/entity-migration/snapshot.mjs` 重制。
use crate::db::repos::note_links::write::{desired_lines, replace_lines};
use crate::tags::TagLine;
use rusqlite::{params, Connection};

/// 来源的全部非子级线 `(线 id, 目标, 名字点)`(按线 id)
fn rows(c: &Connection, from: i64) -> Vec<(i64, i64, Option<i64>)> {
    c.prepare(
        "SELECT id, to_id, name_id FROM lines
          WHERE from_id = ?1 AND (name_id IS NULL OR name_id <> 0) ORDER BY id",
    )
    .unwrap()
    .query_map(params![from], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
    .unwrap()
    .collect::<Result<_, _>>()
    .unwrap()
}

fn scalar(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
#[ignore = "副本写面验收:需 LIFELOG_SNAPSHOT_DB 指向 VACUUM INTO 副本"]
fn roundtrip_named_lines_keeps_ids_and_names() {
    let path = std::env::var("LIFELOG_SNAPSHOT_DB").expect("需 LIFELOG_SNAPSHOT_DB 指向副本");
    let c = Connection::open(&path).unwrap();
    // 与生产 `db::open` 同口径:连接级标量函数(`lines` 触发器要用 entity_name/tag_plain)+ 外键
    crate::db::sql_functions::register(&c).unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    let named = "SELECT COUNT(*) FROM lines WHERE name_id IS NOT NULL AND name_id <> 0";
    let (named_before, points_before, lines_before) =
        (scalar(&c, named), scalar(&c, "SELECT COUNT(*) FROM points"), scalar(&c, "SELECT COUNT(*) FROM lines"));
    let srcs: Vec<i64> = c
        .prepare("SELECT DISTINCT from_id FROM lines WHERE name_id IS NOT NULL AND name_id <> 0 ORDER BY from_id")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert!(srcs.len() >= 5, "名线来源不足 5 条:{}", srcs.len());
    for src in &srcs {
        let before = rows(&c, *src);
        let tags: Vec<TagLine> = before
            .iter()
            .map(|(_, to, name)| TagLine {
                path: c
                    .query_row("SELECT path FROM points WHERE id = ?1", params![to], |r| r.get(0))
                    .unwrap(),
                name: name.map(|n| {
                    c.query_row("SELECT meta FROM points WHERE id = ?1", params![n], |r| r.get(0))
                        .unwrap()
                }),
            })
            .collect();
        let desired = desired_lines(&c, *src, &tags, "").unwrap();
        replace_lines(&c, *src, &desired).unwrap();
        assert_eq!(rows(&c, *src), before, "来源 {src} 的线在往返里变了");
    }
    assert_eq!(scalar(&c, named), named_before, "名线数变了");
    assert_eq!(scalar(&c, "SELECT COUNT(*) FROM lines"), lines_before, "线数变了");
    assert_eq!(scalar(&c, "SELECT COUNT(*) FROM points"), points_before, "点数变了");
    println!(
        "副本往返无损:{} 个来源点 / 名线 {named_before} 条往返后线 id 与 name_id 逐条不变",
        srcs.len()
    );
}
