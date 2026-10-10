//! 显式链接(`[[X]]`)与实体间引用的仓库层(设计 D3/D4/D6):替换语义写入 + 出链/入链读取。
//! 写入由调用方放在**与标签同一次事务**里(`notes::create_with` / `notes_update::update`),
//! 任一步失败整批回滚;读取时标题一律实时算(目标改名后显示跟随)。
//!
//! 统一元数据(v28):`#X` 与 `[[X]]` 落同一种 `edges(kind='link')`(spec §5.2),
//! 目标裁决统一按 `entity_key(meta)` 等值、同键取 id 最小(spec §10-P5,不再有种类优先);
//! 未解析链接**不落边**(D2 选项 A),出链列表读时从正文重解析。
// 读取(出链/入链/边)拆到 note_links_read.rs 并在此**再导出**,调用方路径不变。
use crate::links::{normalize_title, title_of};
use rusqlite::{params, Connection};

#[path = "note_links_read.rs"]
pub mod read;
pub use read::{
    all_resolved, list_note_links, outbound_of, outbound_page, NoteLinks,
    OutboundLink,
};

/// 一条候选实体:`key` 是等值匹配键(归一化首行 = `links::title_of(meta)`)
pub struct LinkCandidate {
    pub id: i64,
    pub key: String,
}

/// 全库候选表:一次全表扫(本机千余条 <10ms);写入与读取共用同一张。
pub(crate) fn candidates(conn: &Connection) -> rusqlite::Result<Vec<LinkCandidate>> {
    let mut stmt = conn.prepare("SELECT id, meta FROM entities ORDER BY id")?;
    let mut rows = stmt.query([])?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let id: i64 = row.get(0)?;
        let key = title_of(&row.get::<_, String>(1)?);
        if !key.is_empty() {
            out.push(LinkCandidate { id, key });
        }
    }
    Ok(out)
}

/// `[[X]]` 目标裁决:按归一化键等值命中,同键取 id 最小;`exclude` 用来跳过来源自己(自指)。
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
    let mut best: Option<i64> = None;
    for c in cands {
        if Some(c.id) == exclude || c.key != key {
            continue;
        }
        if best.is_none_or(|cur| c.id < cur) {
            best = Some(c.id);
        }
    }
    best
}

/// 解析一批 `[[ ]]` 标题为**目标 id 序列**(只解析、不写库):自指跳过、同键去重、
/// 未解析不产出。供保存路径与标签目标合并成一次整体替换。
pub(crate) fn resolve_titles(
    conn: &Connection,
    source_id: i64,
    titles: &[String],
) -> rusqlite::Result<Vec<i64>> {
    let cands = candidates(conn)?;
    let own = own_title(conn, source_id)?;
    let mut out: Vec<i64> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for raw in titles {
        let key = normalize_title(raw);
        if key.is_empty() || seen.contains(&key) {
            continue;
        }
        seen.push(key.clone());
        let target = resolve_target(&cands, raw, Some(source_id));
        if target.is_none() && own.as_deref() == Some(key.as_str()) {
            continue; // 自指:连未解析都不留
        }
        if let Some(t) = target {
            if !out.contains(&t) {
                out.push(t);
            }
        }
    }
    Ok(out)
}

/// 以 id 集合整体替换来源的全部 `link` 边(删多余、补缺失,`UNIQUE` 去重),收尾回收孤儿。
/// 标签(`#X`)与链接(`[[X]]`)的目标由调用方求并集后从这里一次落库 ——
/// 二者同一种边,分两次替换会互相抹掉。
pub(crate) fn replace_ids(
    conn: &Connection,
    source_id: i64,
    ids: &[i64],
) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM edges WHERE kind = 'link' AND source_id = ?1",
        params![source_id],
    )?;
    let mut written = 0usize;
    for t in ids {
        written += conn.execute(
            "INSERT OR IGNORE INTO edges(source_id, target_id, kind, remark, created_at)
             VALUES(?1, ?2, 'link', '', datetime('now','localtime'))",
            params![source_id, t],
        )?;
    }
    crate::db::repos::tags::gc_orphans(conn)?;
    Ok(written)
}

/// 替换一条来源的全部链接(替换语义,只按正文里的 `[[ ]]` 标题解析)。
/// 生产保存路径已改走 [`replace_ids`](并入标签目标),此入口只剩 note_links 单测在用。
///
/// 返回**解析成功**(`edges` 落边)的条数。
#[cfg(test)]
pub fn replace(conn: &Connection, source_id: i64, titles: &[String]) -> rusqlite::Result<usize> {
    let ids = resolve_titles(conn, source_id, titles)?;
    replace_ids(conn, source_id, &ids)
}

/// 从**已剥净标签、且已落库的那份正文**抽 `[[ ]]` 标题并解析为目标 id(只解析、不写库)。
/// 扫剥净后的正文(而不是用户原始输入):标题写成标签形(`[[#甲]]`)时剥标签后已是 `[[]]`,自然不产生链接。
pub(crate) fn resolve_body(
    conn: &Connection,
    source_id: i64,
    stored_body: &str,
) -> rusqlite::Result<Vec<i64>> {
    let titles: Vec<String> =
        crate::links::link_spans(stored_body).into_iter().map(|s| s.raw_title).collect();
    resolve_titles(conn, source_id, &titles)
}

/// 本笔记自己的归一化首行(整条空白或首行只有标签时为 None):自指判定的另一半。
/// 笔记不存在(脏 source_id)也回 None。
fn own_title(conn: &Connection, id: i64) -> rusqlite::Result<Option<String>> {
    use rusqlite::OptionalExtension;
    let meta: Option<String> =
        conn.query_row("SELECT meta FROM entities WHERE id = ?1", params![id], |r| r.get(0))
            .optional()?;
    Ok(meta.map(|c| title_of(&c)).filter(|t| !t.is_empty()))
}

#[cfg(test)]
#[path = "note_links_tests.rs"]
mod note_links_tests;

/// `all_resolved` 的性能/计划守卫(真库 172ms 事故的回归钉子)。
#[cfg(test)]
#[path = "note_links_perf_tests.rs"]
mod note_links_perf_tests;

#[cfg(test)]
#[path = "note_links_fix_tests.rs"]
mod note_links_fix_tests;

#[cfg(test)]
#[path = "note_links_l3_tests.rs"]
mod note_links_l3_tests;
