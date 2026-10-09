//! `all_resolved` 的性能与查询计划守卫(关系图读数 2:图数据加载 <= 80ms)。
//!
//! 真库现场(v29,2115 实体 / 6909 条 `link` 边):原实现把两端写成
//! `IN (SELECT id FROM entities WHERE path IS NULL)` —— 该子查询没有可用索引(`idx_entities_path`
//! 是部分索引,只管 `path IS NOT NULL`),规划器对 `entities` **全表扫两次**(5.1MB),
//! 单查 172-240ms;改成按主键点查的相关子查询后 3-4ms。
//!
//! ① 非 ignored:`EXPLAIN QUERY PLAN` 里不许再出现 `SCAN entities`(不依赖真库,CI 可跑);
//! ② ignored(真库只读,`LIFELOG_GRAPH_DB`):`all_resolved` 与 `graph_data_dto` 的 min/中位耗时。
use super::read::ALL_RESOLVED_SQL;
use crate::db::migrate;
use rusqlite::{Connection, OpenFlags};
use std::time::{Duration, Instant};

fn plan_lines(c: &Connection) -> Vec<String> {
    let mut stmt = c
        .prepare(&format!("EXPLAIN QUERY PLAN {ALL_RESOLVED_SQL}"))
        .unwrap();
    let rows = stmt.query_map([], |r| r.get::<_, String>(3)).unwrap();
    rows.collect::<rusqlite::Result<Vec<_>>>().unwrap()
}

/// 守卫:两端判据必须是「按 `entities` 主键点查」,不是对 `entities` 的扫描。
#[test]
fn all_resolved_plan_seeks_entities_by_pk() {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    let plan = plan_lines(&c);
    let scanned: Vec<_> = plan.iter().filter(|l| l.contains("SCAN entities")).collect();
    assert!(
        scanned.is_empty(),
        "两端路径树外判据又退化成扫表了(真库上约 172ms -> 会顶爆 80ms 门槛):{plan:#?}"
    );
    assert!(
        plan.iter().filter(|l| l.contains("USING INTEGER PRIMARY KEY")).count() >= 2,
        "两端都应走主键点查:{plan:#?}"
    );
}

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

/// 真库只读读数:`all_resolved` 与整份图 DTO 的 min/中位耗时,断言 min 在门槛内。
#[test]
#[ignore = "真库只读读数:需 LIFELOG_GRAPH_DB"]
fn all_resolved_timing_readout() {
    let path = std::env::var("LIFELOG_GRAPH_DB")
        .expect("未设 LIFELOG_GRAPH_DB(指向真库;本用例只读打开)");
    let c = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let n: usize = std::env::var("LIFELOG_GRAPH_SAMPLES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8);

    let (min_e, med_e) = timed(
        &mut || {
            assert!(super::all_resolved(&c).is_ok());
        },
        n,
    );
    let (min_d, med_d) = timed(
        &mut || {
            assert!(crate::commands::graph::graph_data_dto(&c).is_ok());
        },
        n,
    );
    let edges = super::all_resolved(&c).unwrap();
    eprintln!(
        "真库读数({n} 次):all_resolved min {:.1}ms / 中位 {:.1}ms({} 条边);\
         graph_data_dto min {:.1}ms / 中位 {:.1}ms",
        min_e.as_secs_f64() * 1000.0,
        med_e.as_secs_f64() * 1000.0,
        edges.len(),
        min_d.as_secs_f64() * 1000.0,
        med_d.as_secs_f64() * 1000.0,
    );
    assert!(
        min_e.as_secs_f64() * 1000.0 <= 20.0,
        "all_resolved 冷启动 min {:.1}ms 超出 20ms(两端判据是不是又扫表了)",
        min_e.as_secs_f64() * 1000.0
    );
    // 关系图读数 2 的门槛(`scripts/graph-accept-g1-reads.mjs`):整份图数据 <= 80ms。
    assert!(
        min_d.as_secs_f64() * 1000.0 <= 80.0,
        "graph_data min {:.1}ms 超出 80ms 门槛(找找哪条图查询退化了)",
        min_d.as_secs_f64() * 1000.0
    );
}
