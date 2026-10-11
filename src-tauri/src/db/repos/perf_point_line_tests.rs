//! T4.4 点/线热路径只读读数(spec §12.1 五条 + §12.2 三条新增)。
//!
//! 计划守卫(非 ignored)在 `note_links_perf_tests.rs`(信息流基集 / 侧栏树 / 图闭包三条
//! `EXPLAIN` 守卫);本文件只放需要真库/副本的读数,默认 ignored:
//!   ```text
//!   LIFELOG_COPY_DB=<v31 副本> cargo test --lib -- --ignored perf_point_line --nocapture
//!   LIFELOG_COPY_DB=<v31 副本> LIFELOG_BASE_DB=<迁移前 v30 快照> \
//!     cargo test --lib -- --ignored perf_point_line_index_volume --nocapture
//!   ```
//! 索引体积读数只认 v31 迁移副本:真库在应用运行中会因页面增长与写入变大,跟静态 v30 快照比会误报。
//!
//! 门槛口径:`cargo test --lib` 是 **debug 构建**,SQLite C 以 `-O0` 编译,同一 SQL 约比
//! `-O2` 的原生构建慢 1.6-1.8x。spec §12.1 的树 12ms 是原生读数,在本仓 harness 里连 v30
//! 基线都要 16.8ms(同 harness 实测),故树门槛按现场基线重标为 `TREE_MS`;其余三条在 debug
//! 下本就有余量,沿用 spec 原值。
use crate::commands::graph::{graph_data_dto, HUB_THRESHOLD};
use crate::db::repos::notes::{notes_filter, notes_query};
use crate::db::repos::{graph, note_links, tags};
use rusqlite::{Connection, OpenFlags};
use std::time::{Duration, Instant};

/// 侧栏树门槛(debug harness):v31 现场 15-18ms,v30 同 harness 基线 16.8ms(无回归);
/// 取 25ms 留 ~40% 抖动余量,仍能抓住数量级回归。
const TREE_MS: f64 = 25.0;

fn timed(f: &mut dyn FnMut(), n: usize) -> (Duration, Duration) {
    let mut ts: Vec<Duration> = Vec::with_capacity(n);
    for _ in 0..n {
        let t = Instant::now();
        f();
        ts.push(t.elapsed());
    }
    ts.sort();
    (ts[0], ts[ts.len() / 2])
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

fn samples() -> usize {
    std::env::var("LIFELOG_SAMPLES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8)
}

/// 五条热路径读数 + 载荷字节 / 库文件大小(spec §12.1 + §12.2)。
#[test]
#[ignore = "只读读数:需 LIFELOG_COPY_DB"]
fn perf_point_line_readout() {
    let path = std::env::var("LIFELOG_COPY_DB").expect("需设 LIFELOG_COPY_DB 指向 v31 副本");
    let c = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let n = samples();

    let (f_min, f_med) = timed(
        &mut || {
            notes_query::query(&c, &notes_filter::empty(), 0).unwrap();
        },
        n,
    );
    let (t_min, t_med) = timed(&mut || { tags::counts(&c).unwrap(); }, n);
    let (n_min, _) = timed(&mut || { graph::nodes(&c).unwrap(); }, n);
    let (co_min, _) = timed(&mut || { graph::co_edges(&c, HUB_THRESHOLD).unwrap(); }, n);
    let (g_min, g_med) = timed(&mut || { graph_data_dto(&c).unwrap(); }, n);
    let (a_min, a_med) = timed(&mut || { note_links::all_resolved(&c).unwrap(); }, n);

    let dto = graph_data_dto(&c).unwrap();
    let payload = serde_json::to_vec(&dto).unwrap().len();
    let file_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

    println!(
        "【T4.4 读数】库={path}\n\
         ① 信息流默认筛选单条   min {:.1}ms / 中位 {:.1}ms(门槛 <= 30ms)\n\
         ② 侧栏树全量           min {:.1}ms / 中位 {:.1}ms(门槛 <= {}ms)\n\
         ③ graph_data           min {:.1}ms / 中位 {:.1}ms(门槛 <= 80ms);\
         其中 nodes {:.1}ms / co_edges {:.1}ms\n\
         ④ all_resolved         min {:.1}ms / 中位 {:.1}ms(门槛 <= 20ms)\n\
         graph_data 载荷 {} B = {:.1} KB({} 节点 / {} 边)\n\
         库文件 {} B = {:.2} MB",
        ms(f_min), ms(f_med),
        ms(t_min), ms(t_med), TREE_MS as i64,
        ms(g_min), ms(g_med), ms(n_min), ms(co_min),
        ms(a_min), ms(a_med),
        payload, payload as f64 / 1024.0, dto.nodes.len(), dto.edges.len(),
        file_bytes, file_bytes as f64 / 1048576.0,
    );

    // §12.2 索引体积单独立项(`perf_point_line_index_volume`)。
    if let Ok(base) = std::env::var("LIFELOG_BASE_DB") {
        let base_bytes = std::fs::metadata(&base).map(|m| m.len()).unwrap_or(0);
        println!("  参考:v30 快照 {base_bytes} B(索引体积断言见 perf_point_line_index_volume)");
    }

    assert!(ms(f_min) <= 30.0, "信息流单条 min {:.1}ms 超 30ms", ms(f_min));
    assert!(ms(t_min) <= TREE_MS, "侧栏树 min {:.1}ms 超 {}ms", ms(t_min), TREE_MS);
    assert!(ms(g_min) <= 80.0, "graph_data min {:.1}ms 超 80ms", ms(g_min));
    assert!(ms(a_min) <= 20.0, "all_resolved min {:.1}ms 超 20ms", ms(a_min));
}

/// §12.2 索引体积:v31 迁移副本 vs 迁移前 v30 快照,库文件大小差应 < 5%。
#[test]
#[ignore = "只读读数:需 LIFELOG_COPY_DB + LIFELOG_BASE_DB"]
fn perf_point_line_index_volume() {
    let db = std::env::var("LIFELOG_COPY_DB").expect("需设 LIFELOG_COPY_DB 指向 v31 迁移副本");
    let base = std::env::var("LIFELOG_BASE_DB").expect("需设 LIFELOG_BASE_DB 指向迁移前 v30 快照");
    let a = std::fs::metadata(&db).map(|m| m.len()).unwrap_or(0);
    let b = std::fs::metadata(&base).map(|m| m.len()).unwrap_or(0);
    let diff = (a as f64 - b as f64).abs() / b.max(1) as f64;
    println!(
        "【T4.4 索引体积】v31 {a} B = {:.2} MB vs v30 {b} B = {:.2} MB,差 {:.2}%",
        a as f64 / 1048576.0,
        b as f64 / 1048576.0,
        diff * 100.0
    );
    assert!(diff < 0.05, "v31 库文件与 v30 差 {:.2}%,超出 5%(索引变胖)", diff * 100.0);
}

/// 写路径:插 / 删一条有名关系线(触发 16 个触发器)的耗时;跑完零残留。
#[test]
#[ignore = "会写副本(自清理):需 LIFELOG_COPY_DB"]
fn perf_point_line_write_readout() {
    let path = std::env::var("LIFELOG_COPY_DB").expect("需设 LIFELOG_COPY_DB 指向副本");
    let mut c = Connection::open(&path).unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    crate::db::sql_functions::register(&c).unwrap();

    let count = |c: &Connection, sql: &str| -> i64 { c.query_row(sql, [], |r| r.get(0)).unwrap() };
    let snapshot = |c: &Connection| {
        (
            count(c, "SELECT COUNT(*) FROM points"),
            count(c, "SELECT COUNT(*) FROM lines"),
            count(c, "SELECT COUNT(*) FROM points_fts"),
        )
    };
    let before = snapshot(&c);
    let base = count(&c, "SELECT COALESCE(MAX(id), 0) FROM points");
    let segs = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();

    let a = tags::ensure_path(&c, &segs(&["T44探针", "甲"])).unwrap();
    let b = tags::ensure_path(&c, &segs(&["T44探针", "乙"])).unwrap();

    let t_ins = Instant::now();
    tags::set_tag_relation(&mut c, a, b, "T44名").unwrap();
    let ins = t_ins.elapsed();
    let nid: i64 = c
        .query_row("SELECT id FROM points WHERE meta='T44名' AND path IS NULL", [], |r| r.get(0))
        .unwrap();
    let t_del = Instant::now();
    tags::remove_tag_relation(&mut c, a, b, Some(nid)).unwrap();
    let del = t_del.elapsed();
    println!(
        "【T4.4 写路径】插一条有名线 {:.2}ms(含 16 触发器 + FTS);删一条线 {:.2}ms",
        ms(ins), ms(del)
    );

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
    assert_eq!(snapshot(&c), before, "写路径探针必须零残留");
}
