//! 迁移后基线的生成(计划 T3.5 / spec §7.5):`citations` **现算自库的 `link` 边**,不是现算自正文。
//!
//! * fixture 语料当库:每条向量按**产品写路径**(`notes::create_with`)落成一篇笔记,
//!   再读回它的 `edges(kind='link')` 目标 id。`[[X]]` 只在库内已存在的实体里裁决
//!   (未解析不落边),`#X` 沿 `parent_id` 逐段寻址、未命中自动建树 —— 与真库口径同一份代码。
//! * 真库抽样:每条实体的 `citations` 直接读它现成的边,不重解析正文。
//!
//! 生成器与回归测试都调本模块,口径不会两处各写一遍。
use super::{BaselineEntry, Case, Expect, SOURCE_DB, SOURCE_FIXTURE};
use crate::db::repos::notes;
use rusqlite::{Connection, OpenFlags};
use std::collections::{BTreeMap, HashSet};
use std::path::Path;

pub const DEFAULT_SAMPLE: usize = 300;
const PER_CATEGORY: usize = 60;
const MAX_CONTENT_CHARS: usize = 200;

/// 用仓库内向量构造新基线(fixture 来源,提交进仓库;向量本身已是公开语料)
pub fn build_fixture_baseline(cases: &[Case]) -> Result<Vec<BaselineEntry>, String> {
    let mut conn = fresh_db()?;
    let mut out = Vec::with_capacity(cases.len());
    for c in cases {
        let note = notes::create_with(&mut conn, &c.content, None)
            .map_err(|e| format!("写向量失败({}): {e}", c.why))?;
        let citations = citations_of(&conn, note.id).map_err(|e| format!("读 link 边失败: {e}"))?;
        out.push(BaselineEntry {
            source: SOURCE_FIXTURE.to_string(),
            why: c.why.clone(),
            content: c.content.clone(),
            expect: Expect { citations, title: crate::links::display_title(&note.content) },
        });
    }
    Ok(out)
}

/// 最新版式内存库(`sql_functions::register` 必须在任何迁移/触发器之前挂上)
fn fresh_db() -> Result<Connection, String> {
    let conn = Connection::open_in_memory().map_err(|e| format!("开内存库失败: {e}"))?;
    crate::db::sql_functions::register(&conn).map_err(|e| format!("注册数据库函数失败: {e}"))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("设置 foreign_keys 失败: {e}"))?;
    crate::db::migrate::run(&conn).map_err(|e| format!("迁移到最新失败: {e}"))?;
    Ok(conn)
}

/// 现算一条实体的 `link` 边目标:按边 `id`(= 落库序:写入侧先标签目标、后正文链接)升序
fn citations_of(conn: &Connection, id: i64) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn
        .prepare("SELECT target_id FROM edges WHERE source_id = ?1 AND kind = 'link' ORDER BY id")?;
    let rows = stmt.query_map([id], |r| r.get(0))?;
    rows.collect()
}

/// 只读抽样真库:按类别分桶(每类上限 [`PER_CATEGORY`]),按内容摘要去重 + 排序,
/// 结果与遍历顺序无关。正文先过滤 `SAVEPROBE`、截断到 [`MAX_CONTENT_CHARS`] 再进基线;
/// 输出只落仓库外快照区(公开仓库不收真库正文)。
pub fn sample_db(path: &Path, limit: usize) -> Result<Vec<BaselineEntry>, String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("只读打开 {} 失败: {e}", path.display()))?;
    let mut stmt = conn
        .prepare("SELECT id, meta FROM entities ORDER BY id")
        .map_err(|e| format!("准备查询失败: {e}"))?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| format!("查询失败: {e}"))?;
    let mut buckets: BTreeMap<&'static str, Vec<(String, BaselineEntry)>> = BTreeMap::new();
    let mut seen: HashSet<String> = HashSet::new();
    for row in rows {
        let (id, raw) = row.map_err(|e| format!("读取行失败: {e}"))?;
        if raw.contains("SAVEPROBE") {
            continue;
        }
        let content: String = raw.chars().take(MAX_CONTENT_CHARS).collect();
        let sha = super::sha256_hex(content.as_bytes());
        let (tags, links, ..) = super::parse_content(&content);
        let category = super::categorize(&content, &tags, &links);
        let bucket = buckets.entry(category).or_default();
        if bucket.len() >= PER_CATEGORY || !seen.insert(sha.clone()) {
            continue;
        }
        let entry = BaselineEntry {
            source: SOURCE_DB.to_string(),
            why: category.to_string(),
            content,
            expect: Expect {
                citations: citations_of(&conn, id).map_err(|e| format!("读 link 边失败: {e}"))?,
                title: crate::links::display_title(&raw),
            },
        };
        bucket.push((sha, entry));
    }
    let mut out: Vec<(String, BaselineEntry)> = buckets.into_values().flatten().collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out.into_iter().take(limit).map(|(_, e)| e).collect())
}
