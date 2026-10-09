//! 关系图 IPC(G1 Task 1):一条只读命令把标签骨架图一次交给前端。
//! 不写库、不迁表、不自造版本号 —— 缓存失效由前端既有的 dataVersion 通道负责。
use crate::db::repos::graph::{self, EdgeKind};
use crate::db::Db;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNodeDto {
    pub id: i64,
    pub path: String,
    pub depth: i64,
    pub parent: Option<i64>,
    pub notes: i64,
    pub self_count: i64,
    pub sort_order: i64,
}

/// 一条边:`tree` / `co` 的 `a`/`b` 是**标签 id**;`link` 的 `a`/`b` 是**笔记 id**
/// (笔记节点只在展开时出现,所以这类边由前端按「两端都在展开的扇形里」决定画不画)。
#[derive(Serialize)]
pub struct GraphEdgeDto {
    pub a: i64,
    pub b: i64,
    pub kind: &'static str,
    pub weight: i64,
}

#[derive(Serialize)]
pub struct GraphData {
    pub nodes: Vec<GraphNodeDto>,
    pub edges: Vec<GraphEdgeDto>,
}

/// 枢纽阈值:出现笔记数 > 60 的标签不参与共现边(设计 D7 的口径,T4.2 按新 `link` 边集重标定)。
///
/// 2026-10-01 定 50 时实测「2628 对 -> 771 条共现边」是本库可读的边预算;此后库里又长了
/// 4 个跨过 50 线的标签(枢纽 22 -> 26,设计文档 §2.2 与本次实测两处读数),同样的 50 只剩
/// 723 条。T4.2 真库读数(2026-10-09,v29;闭包 742 节点 / 1373 条笔记;`graph_calibration_tests.rs`
/// 的 `graph_threshold_readout` 可重跑):
///
/// | 阈值 | 枢纽数 | 共现边(全图) | 共现边(时间轴折叠的默认视图) |
/// |-----|-------|-------------|---------------------------|
/// | 40  | 27    | 701         | 341                       |
/// | 50  | 26    | 723         | 346                       |
/// | 60  | 24    | 771         | 378                       | <- 取这档
/// | 68  | 23    | 811         | 407                       |
/// | 80  | 21    | 916         | 469                       |
///
/// 60 是「共现边回到 2026-10-01 验收过的 771 / 381 边预算」的**最小**整数(共现边数只在
/// 枢纽的度数断点上跳变:53 -> 740、60 -> 771);枢纽占比 24/742 = 3.2%(旧读数 22/742 = 3.0%)。
/// 老 `relation` 边(24 条 tag->tag 的 `link`)对枢纽集合与共现边数**零影响**(带它 / 只认
/// 笔记源两套算逐值相同,已实测),边预算的变化纯来自笔记数增长。
pub(crate) const HUB_THRESHOLD: i64 = 60;

/// 图数据 DTO 组装(自命令抽出):节点(闭包 + 含子级/本级计数)、父子边、共现边、笔记间链接边(L4)。
/// 抽出来是为了让真库阈值标定用例(`graph_calibration_tests::graph_threshold_readout`)能拿
/// 与 IPC 完全相同的一份载荷去量字节数 —— 载荷阈值只有在同一份映射上量才有意义。
pub(crate) fn graph_data_dto(conn: &rusqlite::Connection) -> Result<GraphData, String> {
    let nodes = graph::nodes(conn).map_err(|e| e.to_string())?;
    let mut edges = graph::tree_edges(conn).map_err(|e| e.to_string())?;
    edges.extend(graph::co_edges(conn, HUB_THRESHOLD).map_err(|e| e.to_string())?);
    let links = graph::link_edges(conn).map_err(|e| e.to_string())?;
    Ok(GraphData {
        nodes: nodes
            .into_iter()
            .map(|n| GraphNodeDto {
                id: n.id,
                path: n.path,
                depth: n.depth,
                parent: n.parent,
                notes: n.notes,
                self_count: n.self_count,
                sort_order: n.sort_order,
            })
            .collect(),
        edges: edges
            .into_iter()
            .map(|e| GraphEdgeDto {
                a: e.a,
                b: e.b,
                weight: e.weight,
                kind: match e.kind {
                    EdgeKind::Tree => "tree",
                    EdgeKind::Co => "co",
                },
            })
            // 链接边接在同一条列尾:前端按 kind 分流,标签侧的消费者只看得到 tree/co
            .chain(links.into_iter().map(|l| GraphEdgeDto {
                a: l.a,
                b: l.b,
                kind: "link",
                weight: 1,
            }))
            .collect(),
    })
}

/// 图数据 IPC:节点 + 父子边 + 共现边 + 链接边
#[tauri::command]
pub fn graph_data(app: AppHandle) -> Result<GraphData, String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    graph_data_dto(&conn)
}

/// 某标签(含子孙)的「出链 N / 入链 M」(L4 信息条,只读;口径见 `graph::link_degrees`)
#[tauri::command]
pub fn graph_link_degrees(app: AppHandle, tag_id: i64) -> Result<graph::LinkDegrees, String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    graph::link_degrees(&conn, tag_id).map_err(|e| e.to_string())
}
