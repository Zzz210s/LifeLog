//! 笔记间显式链接的仓库层(设计 D3/D4/D6):替换语义写入 + 出链/入链读取。
//! 写入由调用方放在**与标签同一次事务**里(`notes::create_with` / `notes_update::update`),
//! 任一步失败整批回滚;读取时标题一律用 `links::title_of` **实时算**(目标改名后显示跟随)。
// 读取接口有三个消费方在 L2/L3/L4(卡片反向引用、编辑面板、关系图 link 边),接线前整体放行
// dead_code —— 接线后删掉下面这行(与 tags/tree.rs 当时同一做法)。
#![allow(dead_code)]

use crate::links::{normalize_title, title_of};
use rusqlite::{params, params_from_iter, Connection};
use serde::Serialize;
use std::collections::HashMap;

/// 一条出链:`raw_title` 是正文里写的原文(未命中时界面照它显示),
/// `title` 是目标**当前**首行(目标已删时为 None)。
#[derive(Debug, PartialEq, Serialize)]
pub struct OutboundLink {
    pub target_id: Option<i64>,
    pub raw_title: String,
    pub title: Option<String>,
}

/// 一条入链(引用来源):只带来源首行,不带来源正文
#[derive(Debug, PartialEq, Serialize)]
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

/// 替换一条笔记的全部链接(替换语义,与 `tags::link_paths` 同口径):
/// 先整批删掉旧的,再按正文里的标题序列逐条重建。
///
/// - 一次拉全库候选在内存里建「归一化首行 -> id 最小的一条」映射(设计 §2.2:本机千余条
///   笔记一次全表扫 <10ms;上万条时再加归一化生成列 + 索引)
/// - 指向自己的**跳过**(自指不建边,连未解析行都不留):判据是「该标题归一化后等于本笔记
///   自己的首行,且库里没有第二条同名笔记」—— 若还有同名笔记,那条链接该指向它
/// - 没命中的写 `target_id = NULL`(D4:允许保存,界面显示为未解析链接)
/// - 同一条笔记里写重复的同一个 raw_title 只留一行(否则「被引用 N」会把同一来源算两遍)
///
/// 返回**解析成功**(`target_id` 非空)的条数。
pub fn replace(conn: &Connection, source_id: i64, titles: &[String]) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM note_links WHERE source_id = ?1", params![source_id])?;
    let by_title = title_index(conn, source_id)?;
    let own = own_title(conn, source_id)?;
    let mut resolved = 0usize;
    let mut seen: Vec<&str> = Vec::new();
    for raw in titles {
        if seen.contains(&raw.as_str()) {
            continue;
        }
        seen.push(raw);
        let key = normalize_title(raw);
        let target = if key.is_empty() { None } else { by_title.get(&key).copied() };
        if target.is_none() && own.as_deref() == Some(key.as_str()) {
            continue; // 自指
        }
        if target.is_some() {
            resolved += 1;
        }
        conn.execute(
            "INSERT INTO note_links(source_id, target_id, raw_title, created_at)
             VALUES(?1, ?2, ?3, datetime('now','localtime'))",
            params![source_id, target, raw],
        )?;
    }
    Ok(resolved)
}

/// 保存路径的唯一入口:从**已剥净标签、且已落库的那份正文**抽链接并替换写入。
/// 扫剥净后的正文(而不是用户原始输入)有两个好处:① `note_links.raw_title` 一定能在库里的
/// 正文中找到(两边同一份文本);② 标题写成标签形(`[[#甲]]`)时剥标签后已是 `[[]]`,
/// 自然不产生链接(设计 §5 边界 5)。
/// 调用方保证:在事务内、紧跟 `tags::link_paths` 之后。
pub fn replace_from_body(conn: &Connection, source_id: i64, stored_body: &str) -> rusqlite::Result<usize> {
    let titles: Vec<String> =
        crate::links::link_spans(stored_body).into_iter().map(|s| s.raw_title).collect();
    replace(conn, source_id, &titles)
}

/// 「归一化首行 -> 笔记 id」索引:同名取 **id 最小**(最早)的一条(D3)。
/// 排除 `source_id` 自己(自指由 `own_title` 单独判,见 `replace`)。
/// 首行归一化后为空(整条空白、或首行只有标签,§5 边界 2)的笔记不入索引(不可被链接)。
fn title_index(conn: &Connection, source_id: i64) -> rusqlite::Result<HashMap<String, i64>> {
    let mut stmt = conn.prepare("SELECT id, content FROM notes WHERE id <> ?1 ORDER BY id")?;
    let mut rows = stmt.query(params![source_id])?;
    let mut map: HashMap<String, i64> = HashMap::new();
    while let Some(row) = rows.next()? {
        let id: i64 = row.get(0)?;
        let key = title_of(&row.get::<_, String>(1)?);
        if !key.is_empty() {
            map.entry(key).or_insert(id); // ORDER BY id ⇒ 首次写入即最小
        }
    }
    Ok(map)
}

/// 本笔记自己的归一化首行(整条空白或首行只有标签时为 None):自指判定的另一半。
/// 笔记不存在(脏 source_id)也回 None。
fn own_title(conn: &Connection, id: i64) -> rusqlite::Result<Option<String>> {
    use rusqlite::OptionalExtension;
    let content: Option<String> =
        conn.query_row("SELECT content FROM notes WHERE id = ?1", params![id], |r| r.get(0)).optional()?;
    Ok(content.map(|c| title_of(&c)).filter(|t| !t.is_empty()))
}

/// 单条笔记的出链 + 入链(编辑面板用)。出链按正文出现顺序(插入序 = id 升序);
/// 入链按来源 id 升序,同一条来源只出现一次(DISTINCT:正文里引用两遍算一个人)。
pub fn list_note_links(conn: &Connection, note_id: i64) -> rusqlite::Result<NoteLinks> {
    let mut out_stmt = conn.prepare(
        "SELECT l.target_id, l.raw_title, n.content FROM note_links l
         LEFT JOIN notes n ON n.id = l.target_id
         WHERE l.source_id = ?1 ORDER BY l.id",
    )?;
    let outbound = out_stmt
        .query_map(params![note_id], |r| {
            let content: Option<String> = r.get(2)?;
            Ok(OutboundLink {
                target_id: r.get(0)?,
                raw_title: r.get(1)?,
                title: content.as_deref().map(title_of),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut in_stmt = conn.prepare(
        "SELECT DISTINCT l.source_id, n.content FROM note_links l
         JOIN notes n ON n.id = l.source_id
         WHERE l.target_id = ?1 ORDER BY l.source_id",
    )?;
    let backlinks = in_stmt
        .query_map(params![note_id], |r| {
            Ok(Backlink { source_id: r.get(0)?, title: title_of(&r.get::<_, String>(1)?) })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(NoteLinks { outbound, backlinks })
}

/// 一页笔记的被引用计数(`target_id -> 引用条数`),一条 SQL 批量取全:
/// 笔记流 50 张卡不该每张卡一条查询(设计 §3.0 的硬约束)。
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
pub fn all_resolved(conn: &Connection) -> rusqlite::Result<Vec<(i64, i64)>> {
    let mut stmt = conn
        .prepare("SELECT source_id, target_id FROM note_links WHERE target_id IS NOT NULL ORDER BY id")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

#[cfg(test)]
#[path = "note_links_tests.rs"]
mod note_links_tests;
