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

/// 枢纽阈值:出现笔记数 > 50 的标签不参与共现边(设计 D7,实测边数 2628 -> 771)
const HUB_THRESHOLD: i64 = 50;

/// 图数据:节点(标签 + 含子级笔记数)、父子边、共现边、笔记间链接边(L4)
#[tauri::command]
pub fn graph_data(app: AppHandle) -> Result<GraphData, String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let nodes = graph::nodes(&conn).map_err(|e| e.to_string())?;
    let mut edges = graph::tree_edges(&conn).map_err(|e| e.to_string())?;
    edges.extend(graph::co_edges(&conn, HUB_THRESHOLD).map_err(|e| e.to_string())?);
    let links = graph::link_edges(&conn).map_err(|e| e.to_string())?;
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

/// 某标签(含子孙)的「出链 N / 入链 M」(L4 信息条,只读;口径见 `graph::link_degrees`)
#[tauri::command]
pub fn graph_link_degrees(app: AppHandle, tag_id: i64) -> Result<graph::LinkDegrees, String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    graph::link_degrees(&conn, tag_id).map_err(|e| e.to_string())
}
