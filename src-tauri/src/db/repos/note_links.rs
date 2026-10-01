//! 笔记间显式链接的仓库层(设计 D3/D4/D6):替换语义写入 + 出链/入链读取。
//! 写入由调用方放在**与标签同一次事务**里(`notes::create_with` / `notes_update::update`),
//! 任一步失败整批回滚;读取时标题一律用 `links::display_title` **实时算**(目标改名后显示跟随)。
// 读取(出链/入链/边)拆到 note_links_read.rs 并在此**再导出**,调用方路径不变
// (crate::db::repos::note_links::outbound_page ...);本文件只留写入。

use crate::links::{normalize_title, title_of};
use rusqlite::{params, Connection};
use std::collections::HashMap;

#[path = "note_links_read.rs"]
pub mod read;
// 再导出:L3 的出链/入链/计数已接 IPC 消费;`all_resolved`(L4 关系图边)尚未接线,
// 故整行仍放行 unused_imports,接完 L4 删掉这属性。
#[allow(unused_imports)]
pub use read::{
    all_resolved, list_links_page, list_note_links, outbound_of, outbound_page, Backlink,
    NoteLinks, OutboundLink,
};

/// 替换一条笔记的全部链接(替换语义,与 `tags::link_paths` 同口径):
/// 先整批删掉旧的,再按正文里的标题序列逐条重建。
///
/// - 一次拉全库候选在内存里建「归一化首行 -> id 最小的一条」映射(设计 §2.2:本机千余条
///   笔记一次全表扫 <10ms;上万条时再加归一化生成列 + 索引)
/// - 指向自己的**跳过**(自指不建边,连未解析行都不留):判据是「该标题归一化后等于本笔记
///   自己的首行,且库里没有第二条同名笔记」—— 若还有同名笔记,那条链接该指向它
/// - 没命中的写 `target_id = NULL`(D4:允许保存,界面显示为未解析链接)
/// - 同一条笔记里写重复的**同一个归一化标题**(大小写/空白差异视为同一条)只留一行,
///   否则「被引用 N」会把同一来源算两遍
///
/// 返回**解析成功**(`target_id` 非空)的条数。
pub fn replace(conn: &Connection, source_id: i64, titles: &[String]) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM note_links WHERE source_id = ?1", params![source_id])?;
    let by_title = title_index(conn, source_id)?;
    let own = own_title(conn, source_id)?;
    let mut resolved = 0usize;
    let mut seen: Vec<String> = Vec::new();
    for raw in titles {
        let key = normalize_title(raw);
        // 归一化后为空的标题(标签形 `[[#x]]`、纯空白)永远无法命中,不落行。
        // parse_at 已先挡一道,这里是为直调 `replace` 保留的兜底(设计 §5.5)。
        if key.is_empty() || seen.contains(&key) {
            continue;
        }
        seen.push(key.clone());
        let target = by_title.get(&key).copied();
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
            map.entry(key).or_insert(id); // ORDER BY id -> 首次写入即最小
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

#[cfg(test)]
#[path = "note_links_tests.rs"]
mod note_links_tests;

#[cfg(test)]
#[path = "note_links_fix_tests.rs"]
mod note_links_fix_tests;

#[cfg(test)]
#[path = "note_links_l3_tests.rs"]
mod note_links_l3_tests;
