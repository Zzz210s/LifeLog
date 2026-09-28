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
}

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

/// 图数据:节点(标签 + 含子级笔记数)、父子边、共现边
#[tauri::command]
pub fn graph_data(app: AppHandle) -> Result<GraphData, String> {
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let nodes = graph::nodes(&conn).map_err(|e| e.to_string())?;
    let mut edges = graph::tree_edges(&conn).map_err(|e| e.to_string())?;
    edges.extend(graph::co_edges(&conn, HUB_THRESHOLD).map_err(|e| e.to_string())?);
    Ok(GraphData {
        nodes: nodes
            .into_iter()
            .map(|n| GraphNodeDto {
                id: n.id,
                path: n.path,
                depth: n.depth,
                parent: n.parent,
                notes: n.notes,
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
            .collect(),
    })
}
