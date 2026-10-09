//! T4.2 图阈值标定读数(真库**只读**,默认 ignored)。
//!
//! T4.2 阈值定值一览(2026-10-09 真库 v29;读数由本文件的 `graph_threshold_readout` 重跑):
//!
//! | 阈值 | 定值 | 读数与依据 |
//! |------|------|------------|
//! | `HUB_THRESHOLD`(后端) | 50 -> **60** | 共现边 723 -> **771**(回到 2026-10-01 验收过的边预算;默认视图 346 -> 378) |
//! | `HUB_NOTES`(前端 LOD) | **100**(不变) | `selfCount >= 100` 命中 19 个节点(默认视图 17,旧读数 16) |
//! | `HUB_RING_DEGREE`(前端) | **10**(不变) | 默认视图度数 >= 10 的 24 个节点(全图 66),最大度数 57 |
//! | `maxDepth` 默认 | **6**(不变) | 闭包最大 depth = 5,默认值即全可见 |
//! | `onlyWithNotes` / `minNotes` 默认 | **false / 0**(不变) | 闭包每个节点含子级 `notes` 必 >= 1 -> 这两档结构性空转(见 `graph-filters.ts` 注释) |
//! | `graph_data` 载荷阈值 | **200KB**(不变) | 实测 **142.0KB**(145,432 B / 742 节点 / 1489 边),余量 41% |
//!
//! 阈值不是拍出来的:统一实体后节点集合 = §3.3 渲染闭包(742),共现边口径 = `link` 全量,
//! 所以 `HUB_THRESHOLD` 必须按真库的度分布重算。本文件把「度数 top / 各档共现边数 /
//! 默认视图共现边数 / 枢纽文字条数」一次打全,并断言可读区间 —— 阈值设错(例如设 0)
//! 时共现边会爆到三千条,断言立刻变红。
//!
//! 跑法:
//! ```text
//! LIFELOG_GRAPH_DB="C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db" \
//!   cargo test --lib graph_threshold_readout -- --ignored --nocapture
//! ```
use super::{co_edges, nodes};
use crate::commands::graph::HUB_THRESHOLD;
use rusqlite::{Connection, OpenFlags};
use std::collections::HashSet;

/// 可读区间:全图共现边数。2026-10-01 验收过的边预算是 771,真库现读 771(下界 600 / 上界 900):
/// 上界 900 挡「阈值太大 -> 枢纽全放进来 -> 三千条毛球」,下界 600 挡「阈值太小 -> 全被排除 ->
/// 图上一条共现都没有」(阈值设 0 时实测 0 条 —— 除了根实体,每个目标都成了枢纽)。
const CO_EDGES_READABLE: (usize, usize) = (600, 900);

/// 枢纽占比上界(百分比):枢纽是「不参与共现的大标签」,超过 5% 说明阈值定低了。
const HUB_SHARE_PERCENT_MAX: usize = 5;

/// 镜像 `src/main-window/graph/graph-draw-plan-metrics.ts::HUB_NOTES`(LOD 枢纽文字阈值,吃
/// `selfCount` 本级口径;两处必须同步改,`scripts/graph-accept-g3-filter.mjs` 的读数也按 100 判定)。
const HUB_NOTES: i64 = 100;

/// 枢纽文字条数的可读区间。旧读数 16(2026-09-29),本次实测 19 —— 十几个到几十个都算对,
/// 0 条说明阈值高到没有文字,全量说明阈值形同虚设。
const LABELS_BAND: (usize, usize) = (10, 40);

/// 镜像 `scripts/graph-accept-g1-reads.mjs` 的载荷阈值 200KB —— 量的是同一份 DTO(`graph_data_dto`)
/// 的 serde_json 字节数,页面侧那个探针量的是同一个东西。
const PAYLOAD_MAX_BYTES: usize = 200 * 1024;

fn real_db() -> Connection {
    let path = std::env::var("LIFELOG_GRAPH_DB")
        .expect("未设 LIFELOG_GRAPH_DB(指向真库;本用例只读打开)");
    Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap()
}

/// `(目标 id, 度数)` 按度数降序、同度按 id 升序;度数 = `link` 入边的去重来源数
fn degrees(c: &Connection) -> Vec<(i64, i64)> {
    let mut stmt = c
        .prepare(
            "SELECT target_id, COUNT(DISTINCT source_id) n FROM edges WHERE kind = 'link'
             GROUP BY target_id ORDER BY n DESC, target_id",
        )
        .unwrap();
    let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap();
    rows.collect::<rusqlite::Result<Vec<_>>>().unwrap()
}

fn hub_count(deg: &[(i64, i64)], threshold: i64) -> usize {
    deg.iter().filter(|(_, n)| *n > threshold).count()
}

/// 折叠根(`time_tag_template` 首段,本机 = `时间`)的全部后代 id
fn collapsed_ids(c: &Connection) -> HashSet<i64> {
    let tpl: String = c
        .query_row(
            "SELECT value FROM settings WHERE key = 'time_tag_template'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "时间/{y}/{m}/{d}".to_string());
    let root: Option<i64> = c
        .query_row(
            "SELECT id FROM entities WHERE path = ?1",
            [tpl.split('/').next().unwrap_or_default()],
            |r| r.get(0),
        )
        .ok();
    let Some(root) = root else { return HashSet::new() };
    let mut stmt = c
        .prepare(
            "WITH RECURSIVE s(id) AS (
               SELECT id FROM entities WHERE parent_id = ?1
               UNION ALL SELECT e.id FROM entities e JOIN s ON e.parent_id = s.id)
             SELECT id FROM s",
        )
        .unwrap();
    let rows = stmt.query_map([root], |r| r.get::<_, i64>(0)).unwrap();
    rows.collect::<rusqlite::Result<HashSet<i64>>>().unwrap()
}

/// 默认视图(折叠根整棵子树隐藏)下**两端都可见**的共现边数 —— 与前端 `applyFilters` 同口径
fn default_view_co_edges(c: &Connection, threshold: i64) -> usize {
    let hidden = collapsed_ids(c);
    co_edges(c, threshold)
        .unwrap()
        .into_iter()
        .filter(|e| !hidden.contains(&e.a) && !hidden.contains(&e.b))
        .count()
}

#[test]
#[ignore = "真库只读验收:需 LIFELOG_GRAPH_DB"]
fn graph_threshold_readout() {
    let c = real_db();
    let version: i64 = c
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert!(
        version >= 28,
        "统一实体(闭包 + link 全量)之前的库没有这张图,读数无意义:user_version={version}"
    );
    let ns = nodes(&c).unwrap();
    let deg = degrees(&c);
    let tree: i64 = c
        .query_row("SELECT COUNT(*) FROM edges WHERE kind = 'child'", [], |r| {
            r.get(0)
        })
        .unwrap();
    let co = co_edges(&c, HUB_THRESHOLD).unwrap();
    let hubs = hub_count(&deg, HUB_THRESHOLD);
    let labels = ns.iter().filter(|n| n.self_count >= HUB_NOTES).count();
    let name = |id: i64| -> String {
        c.query_row(
            "SELECT COALESCE(path, substr(meta, 1, 12)) FROM entities WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| format!("(已删 id={id})"))
    };

    eprintln!("真库图读数:闭包 {} 节点 / 父子边 {tree} 条", ns.len());
    eprintln!("  度数 top8:{}", deg.iter().take(8).map(|(id, n)| format!("{n} {}", name(*id))).collect::<Vec<_>>().join(" / "));
    for t in [20, 30, 40, 50, 60, 68, 80, 100, 200] {
        eprintln!(
            "  阈值 {t}: 枢纽 {} / 共现边(全图) {} / 共现边(默认视图) {}{}",
            hub_count(&deg, t),
            co_edges(&c, t).unwrap().len(),
            default_view_co_edges(&c, t),
            if t == HUB_THRESHOLD { "  <- HUB_THRESHOLD" } else { "" }
        );
    }
    eprintln!(
        "  实取 HUB_THRESHOLD={HUB_THRESHOLD}:枢纽 {hubs}({:.1}%)/ 共现边 {} / 默认视图 {}\n  \
         枢纽文字(selfCount >= {HUB_NOTES}):{labels} 个节点",
        hubs as f64 * 100.0 / ns.len() as f64,
        co.len(),
        default_view_co_edges(&c, HUB_THRESHOLD),
    );
    let dto = crate::commands::graph::graph_data_dto(&c).unwrap();
    let payload = serde_json::to_vec(&dto).unwrap().len();
    eprintln!(
        "  graph_data 载荷 {payload} B = {:.1} KB({} 节点 / {} 边)",
        payload as f64 / 1024.0,
        dto.nodes.len(),
        dto.edges.len()
    );

    assert!(
        (CO_EDGES_READABLE.0..=CO_EDGES_READABLE.1).contains(&co.len()),
        "共现边 {} 落在可读区间 {:?} 之外(HUB_THRESHOLD={HUB_THRESHOLD} 需重标定:多了是毛球,少了等于枢纽全被排除)",
        co.len(),
        CO_EDGES_READABLE
    );
    assert!(
        hubs * 100 <= ns.len() * HUB_SHARE_PERCENT_MAX,
        "枢纽 {hubs} 占 {} 节点超过 {HUB_SHARE_PERCENT_MAX}%(阈值太小)",
        ns.len()
    );
    assert!(
        (LABELS_BAND.0..=LABELS_BAND.1).contains(&labels),
        "枢纽文字 {labels} 条落在可读区间 {LABELS_BAND:?} 之外(HUB_NOTES={HUB_NOTES} 需重标定)"
    );
    assert!(
        payload <= PAYLOAD_MAX_BYTES,
        "graph_data 载荷 {payload} B 超出 {PAYLOAD_MAX_BYTES} B(图或 id 位数是否又长胖了)"
    );
}
