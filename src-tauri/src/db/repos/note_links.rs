//! 笔记间显式链接的仓库层(设计 D3/D4/D6):替换语义写入 + 出链/入链读取。
//! 写入由调用方放在**与标签同一次事务**里(`notes::create_with` / `notes_update::update`),
//! 任一步失败整批回滚;读取时标题一律实时算(目标改名后显示跟随)。
//!
//! 阶段 4(T4.6):边落 `edges(kind='link')`,目标裁决先按 `entities.name` 命中标签(D6);
//! 未解析链接**不落边**(D2 选项 A),出链列表读时从正文重解析。
//! 过渡期仍双写老 `note_links`(旧读方 `graph::link_degrees` 还读它,027 删净):
//! 目标不是笔记(标签实体或未解析)时老表 target_id 写 NULL —— 老表外键只认 `notes.id`。
// 读取(出链/入链/边)拆到 note_links_read.rs 并在此**再导出**,调用方路径不变。
use crate::db::repos::entities::ids::is_tag_entity;
use crate::links::{normalize_title, title_of};
use rusqlite::{params, Connection};

#[path = "note_links_read.rs"]
pub mod read;
pub use read::{
    all_resolved, list_links_page, list_note_links, outbound_of, outbound_page, NoteLinks,
    OutboundLink,
};

/// 参与 `[[ ]]` 目标裁决的实体种类(D6:标签优先于笔记)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkKind {
    Note,
    Tag,
}

/// 一条候选实体:`key` 是等值匹配键(标签 = 归一化 `name`,笔记 = 归一化首行)
pub struct LinkCandidate {
    pub id: i64,
    pub kind: LinkKind,
    pub key: String,
}

/// 全库候选表(D6):一次全表扫(本机千余条 <10ms);写入与读取共用同一张。
pub(crate) fn candidates(conn: &Connection) -> rusqlite::Result<Vec<LinkCandidate>> {
    let mut stmt = conn.prepare(
        "SELECT id, kind, COALESCE(name, ''), content FROM entities
         WHERE kind IN ('tag', 'note') ORDER BY id",
    )?;
    let mut rows = stmt.query([])?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let id: i64 = row.get(0)?;
        let (kind, key) = if row.get::<_, String>(1)? == "tag" {
            (LinkKind::Tag, normalize_title(&row.get::<_, String>(2)?))
        } else {
            (LinkKind::Note, title_of(&row.get::<_, String>(3)?))
        };
        if !key.is_empty() {
            out.push(LinkCandidate { id, kind, key });
        }
    }
    Ok(out)
}

/// `[[X]]` 目标裁决(D6):先在 `name` 命中的标签里取 id 最小,再在笔记首行里取 id 最小;
/// 标签优先。`exclude` 用来跳过来源自己(自指)。
pub fn resolve_target(
    cands: &[LinkCandidate],
    raw_title: &str,
    exclude: Option<i64>,
) -> Option<i64> {
    resolve_key(cands, &normalize_title(raw_title), exclude)
}

/// 已归一化键的裁决内核(写入与读取共用同一个 `normalize_title`,口径不会漂)。
pub fn resolve_key(cands: &[LinkCandidate], key: &str, exclude: Option<i64>) -> Option<i64> {
    if key.is_empty() {
        return None;
    }
    let (mut tag, mut note) = (None, None);
    for c in cands {
        if Some(c.id) == exclude || c.key != key {
            continue;
        }
        let slot = if c.kind == LinkKind::Tag { &mut tag } else { &mut note };
        if slot.is_none_or(|cur| c.id < cur) {
            *slot = Some(c.id);
        }
    }
    tag.or(note)
}

/// 替换一条笔记的全部链接(替换语义,与 `tags::link_paths` 同口径):
/// 先整批删掉旧的,再按正文里的标题序列逐条重建。
///
/// - 目标裁决走 [`resolve_target`](D6):标签优先、同类 id 最小;都没命中 → 未解析
/// - 自指跳过(判据沿用旧实现:标题归一化后等于本笔记自己的首行,且没有别人命中)
/// - **未解析链接不落 `edges`**(D2 选项 A);老 `note_links` 仍按旧口径写一行(过渡镜像)
/// - 同一条笔记里写重复的**同一个归一化标题**只处理一次
///
/// 返回**解析成功**(`edges` 落边)的条数。
pub fn replace(conn: &Connection, source_id: i64, titles: &[String]) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM note_links WHERE source_id = ?1", params![source_id])?;
    conn.execute(
        "DELETE FROM edges WHERE kind = 'link' AND source_id = ?1",
        params![source_id],
    )?;
    let cands = candidates(conn)?;
    let own = own_title(conn, source_id)?;
    let mut resolved = 0usize;
    let mut seen: Vec<String> = Vec::new();
    for raw in titles {
        let key = normalize_title(raw);
        // 归一化后为空的标题(标签形 `[[#x]]`、纯空白)永远无法命中,不落行。
        if key.is_empty() || seen.contains(&key) {
            continue;
        }
        seen.push(key.clone());
        let target = resolve_target(&cands, raw, Some(source_id));
        if target.is_none() && own.as_deref() == Some(key.as_str()) {
            continue; // 自指:连未解析都不留
        }
        if let Some(t) = target {
            conn.execute(
                "INSERT OR IGNORE INTO edges(source_id, target_id, kind, remark, created_at)
                 VALUES(?1, ?2, 'link', '', datetime('now','localtime'))",
                params![source_id, t],
            )?;
            resolved += 1;
        }
        // 过渡镜像:老表的 target_id 外键只认 `notes.id`,标签实体(带偏移)只能写 NULL。
        let legacy = target.filter(|id| !is_tag_entity(*id));
        conn.execute(
            "INSERT INTO note_links(source_id, target_id, raw_title, created_at)
             VALUES(?1, ?2, ?3, datetime('now','localtime'))",
            params![source_id, legacy, raw],
        )?;
    }
    Ok(resolved)
}

/// 保存路径的唯一入口:从**已剥净标签、且已落库的那份正文**抽链接并替换写入。
/// 扫剥净后的正文(而不是用户原始输入):① `raw_title` 一定能在库里的正文中找到
/// (两边同一份文本);② 标题写成标签形(`[[#甲]]`)时剥标签后已是 `[[]]`,自然不产生链接。
/// 调用方保证:在事务内、紧跟 `tags::link_paths` 之后。
pub fn replace_from_body(
    conn: &Connection,
    source_id: i64,
    stored_body: &str,
) -> rusqlite::Result<usize> {
    let titles: Vec<String> =
        crate::links::link_spans(stored_body).into_iter().map(|s| s.raw_title).collect();
    replace(conn, source_id, &titles)
}

/// 本笔记自己的归一化首行(整条空白或首行只有标签时为 None):自指判定的另一半。
/// 笔记不存在(脏 source_id)也回 None。阶段 4 读实体行(老 `notes` 行只是过渡镜像)。
fn own_title(conn: &Connection, id: i64) -> rusqlite::Result<Option<String>> {
    use rusqlite::OptionalExtension;
    let content: Option<String> = conn
        .query_row(
            "SELECT content FROM entities WHERE id = ?1 AND kind = 'note'",
            params![id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(content.map(|c| title_of(&c)).filter(|t| !t.is_empty()))
}

#[cfg(test)]
#[path = "note_links_tests.rs"]
mod note_links_tests;

#[cfg(test)]
#[path = "note_links_legacy_tests.rs"]
mod note_links_legacy_tests;

#[cfg(test)]
#[path = "note_links_fix_tests.rs"]
mod note_links_fix_tests;

#[cfg(test)]
#[path = "note_links_l3_tests.rs"]
mod note_links_l3_tests;
