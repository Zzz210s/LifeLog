//! 笔记间链接的**读取**层(自 note_links.rs 拆出以守 200 行上限;写入见 note_links.rs)。
//! 标题一律用 `links::display_title` **实时算**(目标改名后显示跟随);匹配才用归一化 key。
//! 读取接口有两类消费方:L2 笔记读取(出链随 `Note` 返回,分页靠批量一次取全)、
//! L3 反向引用面板与编辑面板(入链列表 + 被引用计数,均已接 IPC);
//! L4 关系图边(`all_resolved`)尚未接线,仍带 dead_code 放行。

use crate::links::display_title;
use rusqlite::{params, params_from_iter, Connection};
use serde::Serialize;
use std::collections::HashMap;

/// 一条出链:`raw_title` 是正文里写的原文(未命中时界面照它显示),
/// `title` 是目标**当前**首行(目标已删时为 None)。
/// 字段名走 camelCase(前端 `NoteLink` 类型同口径,与 `Note.created_at` 的 snake 直传并存)。
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboundLink {
    pub target_id: Option<i64>,
    pub raw_title: String,
    pub title: Option<String>,
}

/// 一条入链(引用来源):只带来源首行,不带来源正文
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    pub source_id: i64,
    pub title: String,
}

/// 单条笔记的双向链接(编辑面板列表与卡片面板各取所需)
#[derive(Debug, PartialEq, Serialize)]
pub struct NoteLinks {
    pub outbound: Vec<OutboundLink>,
    pub backlinks: Vec<Backlink>,
}

/// 出链的三列(单条/分页共用):target_id / raw_title / 目标正文(取首行用,nil 表示未解析)
const OUTBOUND_COLS: &str = "l.target_id, l.raw_title, n.content";

/// 行映射:`base` 是这三列在行里的起始下标(分页多一列 source_id,起始为 1)。
fn map_outbound(r: &rusqlite::Row<'_>, base: usize) -> rusqlite::Result<OutboundLink> {
    let content: Option<String> = r.get(base + 2)?;
    Ok(OutboundLink {
        target_id: r.get(base)?,
        raw_title: r.get(base + 1)?,
        title: content.as_deref().map(display_title),
    })
}

/// 单条笔记的出链(按正文出现顺序 = 插入序 = id 升序)。
/// 笔记读取路径(read_full)用它,编辑面板与卡片反向引用同源。
pub fn outbound_of(conn: &Connection, note_id: i64) -> rusqlite::Result<Vec<OutboundLink>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {OUTBOUND_COLS} FROM note_links l
         LEFT JOIN notes n ON n.id = l.target_id
         WHERE l.source_id = ?1 ORDER BY l.id"
    ))?;
    let rows = stmt.query_map(params![note_id], |r| map_outbound(r, 0))?;
    rows.collect()
}

/// 一页笔记的出链,`IN (...)` 一次取全(设计 §3.0 硬约束:50 张卡不能 50 次查询)。
/// 没有出链的 id 不进 Map(前端 `.get()` 得 undefined,与空列表同义);空入参直接短路。
pub fn outbound_page(
    conn: &Connection,
    note_ids: &[i64],
) -> rusqlite::Result<HashMap<i64, Vec<OutboundLink>>> {
    if note_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let marks = vec!["?"; note_ids.len()].join(",");
    let mut stmt = conn.prepare(&format!(
        "SELECT l.source_id, {OUTBOUND_COLS} FROM note_links l
         LEFT JOIN notes n ON n.id = l.target_id
         WHERE l.source_id IN ({marks}) ORDER BY l.source_id, l.id"
    ))?;
    let mut rows = stmt.query(params_from_iter(note_ids))?;
    let mut out: HashMap<i64, Vec<OutboundLink>> = HashMap::new();
    while let Some(row) = rows.next()? {
        out.entry(row.get(0)?).or_default().push(map_outbound(row, 1)?);
    }
    Ok(out)
}

/// 单条笔记的出链 + 入链(卡片面板/编辑面板用,IPC `note_links`)。出链按正文出现顺序;
/// 入链按来源 id 升序,同一条来源只出现一次(DISTINCT:正文里引用两遍算一个人)。
pub fn list_note_links(conn: &Connection, note_id: i64) -> rusqlite::Result<NoteLinks> {
    let outbound = outbound_of(conn, note_id)?;
    let mut in_stmt = conn.prepare(
        "SELECT DISTINCT l.source_id, n.content FROM note_links l
         JOIN notes n ON n.id = l.source_id
         WHERE l.target_id = ?1 ORDER BY l.source_id",
    )?;
    let backlinks = in_stmt
        .query_map(params![note_id], |r| {
            Ok(Backlink { source_id: r.get(0)?, title: display_title(&r.get::<_, String>(1)?) })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(NoteLinks { outbound, backlinks })
}

/// 一页笔记的被引用计数(`target_id -> 引用条数`),一条 SQL 批量取全(IPC `note_link_counts`)。
/// 没人引用的 id 不进 Map(前端 `.get()` 得到 undefined,与 0 同义);空入参直接短路。
pub fn list_links_page(conn: &Connection, note_ids: &[i64]) -> rusqlite::Result<HashMap<i64, i64>> {
    if note_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let marks = vec!["?"; note_ids.len()].join(",");
    let mut stmt = conn.prepare(&format!(
        "SELECT target_id, COUNT(*) FROM note_links
         WHERE target_id IS NOT NULL AND target_id IN ({marks}) GROUP BY target_id"
    ))?;
    let rows = stmt.query_map(params_from_iter(note_ids), |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

/// 全部**已解析**的边 `(source_id, target_id)`,插入序;关系图 L4 画 link 边用。
#[allow(dead_code)]
pub fn all_resolved(conn: &Connection) -> rusqlite::Result<Vec<(i64, i64)>> {
    let mut stmt = conn
        .prepare("SELECT source_id, target_id FROM note_links WHERE target_id IS NOT NULL ORDER BY id")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}
