//! T6 收口:真库**只读**读数与副本上的 A5-A8 写面步骤(设计 §8)。
//! 真库以 `SQLITE_OPEN_READ_ONLY` 打开(一个字节都不写);写只在 `snapshot.mjs`(`VACUUM INTO`)
//! 制的副本上,且由 `scripts/relation-syntax-verify.mjs` 逐步驱动(每步之间由脚本用 SQL 取读数,
//! A5-A7 的判定因此拿到的是真实的状态迁移)。两条用例都打印末行 `@@RELJSON@@{...}` 供脚本解析:
//!   LIFELOG_REL_LIVE=<真库> LIFELOG_REL_COPY=<副本> cargo test --lib -- --ignored relation_syntax_readings
//!   LIFELOG_REL_COPY=<副本> LIFELOG_REL_STEP=a8|a5|a6|a7 [LIFELOG_REL_NOTE=<id> LIFELOG_REL_CONTROL=<id>] \
//!     cargo test --lib -- --ignored relation_syntax_copy_step
use crate::db::repos::notes::{self, notes_filter::TagCond, query, FilterConditions};
use crate::db::sql_functions;
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const TARGET: &str = "地点/中国大陆";
const NAME: &str = "国籍";

fn opens(path: &str, ro: bool) -> Connection {
    let c = if ro {
        Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap()
    } else {
        Connection::open(path).unwrap()
    };
    sql_functions::register(&c).unwrap();
    if !ro {
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
    }
    c
}

fn scalar(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn count_on(c: &Connection, sql: &str, arg: i64) -> i64 {
    c.query_row(sql, params![arg], |r| r.get(0)).unwrap()
}

fn id_of(c: &Connection, sql: &str, arg: &str) -> i64 {
    c.query_row(sql, params![arg], |r| r.get(0)).unwrap()
}

/// `(线 id, 名字点)`:来源指向目标的唯一一条线
fn line_of(c: &Connection, from: i64, to: i64) -> Value {
    let r = c
        .query_row(
            "SELECT id, name_id FROM lines WHERE from_id = ?1 AND to_id = ?2",
            params![from, to],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<i64>>(1)?)),
        )
        .ok();
    match r {
        Some((id, name)) => json!({ "id": id, "name_id": name }),
        None => Value::Null,
    }
}

/// `points_fts` 的 `(行数, rowid|paths 拼接的 sha256)` —— A2/A10 的逐字节比对对象
fn fts(c: &Connection) -> (i64, String) {
    let mut st = c.prepare("SELECT rowid, paths FROM points_fts ORDER BY rowid").unwrap();
    let rows: Vec<(i64, String)> = st
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    let mut h = Sha256::new();
    for (id, paths) in &rows {
        h.update(format!("{id}\u{1}{paths}\n").as_bytes());
    }
    (rows.len() as i64, format!("{:x}", h.finalize()))
}

/// A1 的条件集:真库 `settings.filter_current` + 4 组人工条件
fn conditions(c: &Connection) -> Vec<(String, FilterConditions)> {
    let mut out: Vec<(String, FilterConditions)> = Vec::new();
    if let Ok(raw) = c.query_row("SELECT value FROM settings WHERE key = 'filter_current'", [], |r| {
        r.get::<_, String>(0)
    }) {
        if let Ok(fc) = serde_json::from_str::<FilterConditions>(&raw) {
            out.push(("filter_current".into(), fc));
        }
    }
    let tag = |path: &str, ch: bool| TagCond { path: path.into(), include_children: ch };
    out.push(("标签(地点含子级)".into(), FilterConditions { tags: vec![tag("地点", true)], ..Default::default() }));
    out.push(("排除标签(地点含子级)".into(), FilterConditions { exclude_tags: vec![tag("地点", true)], ..Default::default() }));
    out.push(("仅本级(地点/中国大陆)".into(), FilterConditions { tags: vec![tag(TARGET, false)], ..Default::default() }));
    out.push(("关键词(的)".into(), FilterConditions { keyword: Some("的".into()), ..Default::default() }));
    out
}

/// 走生产查询路径分页取全量 id(返回顺序 = 流序)
fn hits(c: &Connection, cond: &FilterConditions) -> Vec<i64> {
    let mut ids: Vec<i64> = Vec::new();
    let mut off = 0_i64;
    loop {
        let page = query(c, cond, off).unwrap();
        let n = page.len() as i64;
        ids.extend(page.into_iter().map(|x| x.id));
        if n == 0 || ids.len() > 100_000 {
            break;
        }
        off += n;
    }
    ids
}

fn readings(c: &Connection) -> Value {
    let (rows, sha) = fts(c);
    let hits: serde_json::Map<String, Value> =
        conditions(c).iter().map(|(k, v)| (k.clone(), json!(hits(c, v)))).collect();
    json!({
        "counts": {
            "points": scalar(c, "SELECT COUNT(*) FROM points"),
            "lines": scalar(c, "SELECT COUNT(*) FROM lines"),
            "named": scalar(c, "SELECT COUNT(*) FROM lines WHERE name_id IS NOT NULL AND name_id <> 0"),
        },
        "named": scalar(c, "SELECT COUNT(*) FROM lines WHERE name_id IS NOT NULL AND name_id <> 0"),
        "fts_rows": rows,
        "fts_sha": sha,
        "hits": hits,
    })
}

#[test]
#[ignore = "只读读数:需 LIFELOG_REL_LIVE + LIFELOG_REL_COPY"]
fn relation_syntax_readings() {
    let live = std::env::var("LIFELOG_REL_LIVE").expect("需 LIFELOG_REL_LIVE");
    let copy = std::env::var("LIFELOG_REL_COPY").expect("需 LIFELOG_REL_COPY");
    let l = opens(&live, true);
    let c = opens(&copy, true);
    println!("@@RELJSON@@{}", json!({ "live": readings(&l), "copy": readings(&c) }));
}

#[test]
#[ignore = "副本写面步骤:需 LIFELOG_REL_COPY + LIFELOG_REL_STEP(a8|a5|a6|a7)"]
fn relation_syntax_copy_step() {
    let copy = std::env::var("LIFELOG_REL_COPY").expect("需 LIFELOG_REL_COPY");
    let step = std::env::var("LIFELOG_REL_STEP").expect("需 LIFELOG_REL_STEP");
    let note = || -> i64 { std::env::var("LIFELOG_REL_NOTE").expect("需 LIFELOG_REL_NOTE").parse().unwrap() };
    let mut c = opens(&copy, false);
    let target = id_of(&c, "SELECT id FROM points WHERE path = ?1", TARGET);
    let out = match step.as_str() {
        // A8 新建可表达:源码里的 `#目标(名字)` 造出名线并**复用**既有名字点;另造一条同目标无名线做 A10 对照
        "a8" => {
            let guo = id_of(&c, "SELECT id FROM points WHERE path IS NULL AND meta = ?1", NAME);
            let named = notes::create_with(&mut c, "#地点/中国大陆(国籍)", None).unwrap();
            let plain = notes::create_with(&mut c, "#地点/中国大陆", None).unwrap();
            let line = line_of(&c, named.id, target);
            assert_eq!(line["name_id"].as_i64(), Some(guo), "A8 必须复用既有名字点");
            json!({ "step": "a8", "note": named.id, "control": plain.id, "target": target,
                    "line": line, "meta": meta_of(&c, named.id),
                    "name_point_fts": count_on(&c, "SELECT COUNT(*) FROM points_fts WHERE rowid = ?1", guo),
                    "paths_named": fts_paths(&c, named.id), "paths_plain": fts_paths(&c, plain.id) })
        }
        // A5 清名字(源码里的裸目标)/ A6 改名 / A7 删除(源码不再写该目标)
        "a5" => { notes::update(&mut c, note(), "#地点/中国大陆").unwrap(); json!({ "step": "a5" }) }
        "a6" => { notes::update(&mut c, note(), "#地点/中国大陆(籍贯)").unwrap(); json!({ "step": "a6" }) }
        "a7" => {
            notes::update(&mut c, note(), "").unwrap();
            let control: i64 = std::env::var("LIFELOG_REL_CONTROL").expect("需 LIFELOG_REL_CONTROL").parse().unwrap();
            notes::update(&mut c, control, "").unwrap();
            let removed = c.execute("DELETE FROM points WHERE id IN (?1, ?2)", params![note(), control]).unwrap();
            json!({ "step": "a7", "removed_notes": removed })
        }
        other => panic!("未知 LIFELOG_REL_STEP: {other}"),
    };
    println!("@@RELJSON@@{out}");
}

fn meta_of(c: &Connection, id: i64) -> String {
    c.query_row("SELECT meta FROM points WHERE id = ?1", params![id], |r| r.get(0)).unwrap()
}

fn fts_paths(c: &Connection, id: i64) -> String {
    c.query_row("SELECT paths FROM points_fts WHERE rowid = ?1", params![id], |r| r.get(0)).unwrap()
}
