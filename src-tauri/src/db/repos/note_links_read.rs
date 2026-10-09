//! 笔记间链接的**读取**层(自 note_links.rs 拆出以守 200 行上限;写入见 note_links.rs)。
//! 阶段 4(T4.6):已解析边读 `edges(kind='link')`,来源/目标正文读 `entities`;
//! 出链的「未解析」在读取时从来源正文重解析得到(D2 选项 A:未解析不落边)。
//! 标题一律实时算(`links::display_title`):目标改名后显示跟随。
//! 消费方:L2 笔记读取(`read_full` / `outbound_page`)、L3 反向引用面板与编辑面板、
//! L4 关系图边与信息条度数(`all_resolved`)。

use super::{candidates, resolve_target, LinkCandidate};
use crate::links::{display_title, normalize_title, title_of};
use rusqlite::{params, params_from_iter, Connection};
use serde::Serialize;
use std::collections::HashMap;

/// 一条出链:`raw_title` 是正文里写的原文(未命中时界面照它显示),
/// `title` 是目标**当前**首行(笔记)或单段名(标签);目标已删/改名为未解析时为 None。
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

/// 目标显示标题:统一取 `meta` 首行(标签的单段名就是它的 `meta`)
fn row_title(row: &rusqlite::Row<'_>, base: usize) -> rusqlite::Result<String> {
    Ok(display_title(&row.get::<_, String>(base)?))
}

/// 某来源的全部已解析链接目标:`target_id -> 目标显示标题`,按边 id 升序
fn edge_targets(conn: &Connection, source_id: i64) -> rusqlite::Result<HashMap<i64, String>> {
    let mut stmt = conn.prepare(
        "SELECT e.target_id, t.meta FROM edges e
         JOIN entities t ON t.id = e.target_id
         WHERE e.kind = 'link' AND e.source_id = ?1 ORDER BY e.id",
    )?;
    let mut rows = stmt.query(params![source_id])?;
    let mut map = HashMap::new();
    while let Some(row) = rows.next()? {
        let id: i64 = row.get(0)?;
        map.insert(id, row_title(row, 1)?);
    }
    Ok(map)
}

/// 出链 = 读时重解析来源正文 + 与已解析的 `link` 边左连接(D2 选项 A):
/// 解析出的目标只有在已解析边里才算「已解析」,否则按未解析显示;
/// 自指与写入侧同口径跳过;同一归一化标题只出现一次。
fn outbound_rows(
    cands: &[LinkCandidate], note_id: i64, content: &str, targets: &HashMap<i64, String>,
) -> Vec<OutboundLink> {
    let own = title_of(content);
    let mut out = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for span in crate::links::link_spans(content) {
        let key = normalize_title(&span.raw_title);
        if key.is_empty() || seen.contains(&key) {
            continue;
        }
        seen.push(key.clone());
        let target = resolve_target(cands, &span.raw_title, Some(note_id))
            .filter(|id| targets.contains_key(id));
        if target.is_none() && own == key {
            continue; // 自指
        }
        out.push(OutboundLink {
            target_id: target,
            title: target.and_then(|id| targets.get(&id).cloned()),
            raw_title: span.raw_title,
        });
    }
    out
}

/// 单条笔记的出链(按正文出现顺序)。笔记读取路径(read_full)用它,编辑面板同源。
pub fn outbound_of(conn: &Connection, note_id: i64) -> rusqlite::Result<Vec<OutboundLink>> {
    use rusqlite::OptionalExtension;
    let sql = "SELECT meta FROM entities WHERE id = ?1";
    let content: Option<String> =
        conn.query_row(sql, params![note_id], |r| r.get(0)).optional()?;
    let Some(content) = content else {
        return Ok(Vec::new());
    };
    let cands = candidates(conn)?;
    let targets = edge_targets(conn, note_id)?;
    Ok(outbound_rows(&cands, note_id, &content, &targets))
}

/// 一页笔记的出链,正文与边各一次取全(设计 §3.0 硬约束:50 张卡不能 50 次查询)。
/// 没有出链的 id 不进 Map(前端 `.get()` 得 undefined,与空列表同义);空入参直接短路。
pub fn outbound_page(
    conn: &Connection, note_ids: &[i64]
) -> rusqlite::Result<HashMap<i64, Vec<OutboundLink>>> {
    if note_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let marks = vec!["?"; note_ids.len()].join(",");
    let mut contents: HashMap<i64, String> = HashMap::new();
    let mut stmt = conn.prepare(&format!(
        "SELECT id, meta FROM entities WHERE id IN ({marks})"
    ))?;
    let mut rows = stmt.query(params_from_iter(note_ids))?;
    while let Some(row) = rows.next()? {
        contents.insert(row.get(0)?, row.get(1)?);
    }
    let mut grouped: HashMap<i64, HashMap<i64, String>> = HashMap::new();
    let mut stmt = conn.prepare(&format!(
        "SELECT e.source_id, e.target_id, t.meta FROM edges e
         JOIN entities t ON t.id = e.target_id
         WHERE e.kind = 'link' AND e.source_id IN ({marks}) ORDER BY e.source_id, e.id"
    ))?;
    let mut rows = stmt.query(params_from_iter(note_ids))?;
    while let Some(row) = rows.next()? {
        grouped.entry(row.get(0)?).or_default().insert(row.get(1)?, row_title(row, 2)?);
    }
    let cands = candidates(conn)?;
    let empty = HashMap::new();
    let mut out: HashMap<i64, Vec<OutboundLink>> = HashMap::new();
    for id in note_ids {
        if let Some(content) = contents.get(id) {
            let links = outbound_rows(&cands, *id, content, grouped.get(id).unwrap_or(&empty));
            if !links.is_empty() {
                out.insert(*id, links);
            }
        }
    }
    Ok(out)
}

/// 单条笔记的出链 + 入链(卡片面板/编辑面板用,IPC `note_links`)。出链按正文出现顺序;
/// 入链按来源 id 升序,同一条来源只出现一次(DISTINCT:正文里引用两遍算一个人)。
pub fn list_note_links(conn: &Connection, note_id: i64) -> rusqlite::Result<NoteLinks> {
    let outbound = outbound_of(conn, note_id)?;
    let mut in_stmt = conn.prepare(
        "SELECT DISTINCT e.source_id, s.meta FROM edges e
         JOIN entities s ON s.id = e.source_id
         WHERE e.kind = 'link' AND e.target_id = ?1 ORDER BY e.source_id",
    )?;
    let backlinks = in_stmt
        .query_map(params![note_id], |r| {
            Ok(Backlink { source_id: r.get(0)?, title: display_title(&r.get::<_, String>(1)?) })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(NoteLinks { outbound, backlinks })
}

/// 一页笔记的被引用计数(`target_id -> 引用条数`),一条 SQL 批量取全(IPC `note_link_counts`)。
/// 没人引用的 id 不进 Map(前端 `.get()` 得 undefined,与 0 同义);空入参直接短路。
pub fn list_links_page(
    conn: &Connection, note_ids: &[i64]
) -> rusqlite::Result<HashMap<i64, i64>> {
    if note_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let marks = vec!["?"; note_ids.len()].join(",");
    let mut stmt = conn.prepare(&format!(
        "SELECT target_id, COUNT(*) FROM edges WHERE kind = 'link' AND target_id IN ({marks})
         GROUP BY target_id"
    ))?;
    let rows = stmt.query_map(params_from_iter(note_ids), |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

/// 全部**已解析且非自指**的笔记间链接边 `(source_id, target_id)`,插入序;关系图 L4 画 link 边用。
/// 自指写入侧就不落边,这里再挡一道:自指在图上是一条零长的线。
/// 028 起 `edges(kind='link')` 也含笔记挂标签与标签关系,故两端都按树外实体(`path IS NULL`)收窄。
///
/// SQL 抽成常量:守卫用例(`note_links_perf_tests`)对同一份文本跑 `EXPLAIN QUERY PLAN`。
/// 两端判据写成**相关子查询**(逐行按 `entities` 主键点查),不是
/// `IN (SELECT id FROM entities WHERE path IS NULL)` —— 后者无可用索引(`idx_entities_path`
/// 是部分索引,只管非 NULL),规划器会对 `entities` 全表扫两次(真库 5.1MB)。
pub(crate) const ALL_RESOLVED_SQL: &str = "\
    SELECT e.source_id, e.target_id FROM edges e
     WHERE e.kind = 'link' AND e.source_id <> e.target_id
       AND EXISTS(SELECT 1 FROM entities s WHERE s.id = e.source_id AND s.path IS NULL)
       AND EXISTS(SELECT 1 FROM entities t WHERE t.id = e.target_id AND t.path IS NULL)
     ORDER BY e.id";

pub fn all_resolved(conn: &Connection) -> rusqlite::Result<Vec<(i64, i64)>> {
    let mut stmt = conn.prepare(ALL_RESOLVED_SQL)?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}
