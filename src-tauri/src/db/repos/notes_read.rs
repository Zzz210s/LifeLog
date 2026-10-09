//! 笔记读取层(自 notes.rs 拆出以守 200 行上限):行映射与折叠、单条读回、最近 N 条、删除、
//! 以及 `[[` 补全候选池(全部笔记的显示首行)。
//! 每条笔记除了标签路径(LEFT JOIN 展开成多行),没有其它派生列 —— 时间标签已是普通标签,与其它标签同列。
use super::Note;
use crate::links::display_title;
use rusqlite::{params, Connection};
use serde::Serialize;

/// 行映射:note 基础列 + 可空标签路径
type NoteRow = (i64, String, String, Option<String>);

/// 四个 SELECT 列(所有读取路径共用同一形状):id/正文(meta)/created_at/标签路径。
fn columns() -> &'static str {
    "n.id, n.meta, n.created_at, t.path"
}

/// 行映射(列顺序见 [`columns`])
pub(crate) fn map_note_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<NoteRow> {
    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
}

/// 相邻同 id 行折叠为一个 Note(tags 收集为列表),recent 与 query 共用。
pub(crate) fn fold_tag_rows(
    rows: impl Iterator<Item = rusqlite::Result<NoteRow>>,
) -> rusqlite::Result<Vec<Note>> {
    let mut out: Vec<Note> = Vec::new();
    for row in rows {
        let (id, content, created_at, tag) = row?;
        match out.last_mut() {
            Some(n) if n.id == id => {
                if let Some(t) = tag {
                    n.tags.push(t);
                }
            }
            _ => out.push(Note {
                id,
                content,
                created_at,
                tags: tag.into_iter().collect(),
                links: Vec::new(), // 单条/分页路径随后用 outbound_of / outbound_page 挂上
            }),
        }
    }
    Ok(out)
}

/// 最近 N 条(id 降序,含全部标签)。当前仅测试使用,生产路径走 query;
/// 标 #[cfg(test)] 以消除非 test 构建的 dead_code 警告。
/// 笔记判据 = 默认筛选口径 `NOT (在树内 且 单行)`(spec §4.1),不再有 `kind='note'`。
/// LIMIT 必须作用在**过滤后的行**上(统一元数据后 `entities` 里还有标签实体,
/// 先取 id 前 N 会把标签算进配额),故用 `feed` CTE 先筛后排。
#[cfg(test)]
pub fn recent(conn: &Connection, limit: u32) -> rusqlite::Result<Vec<Note>> {
    let in_tree = crate::db::repos::entities::closure::in_tree_predicate("n");
    let mut stmt = conn.prepare(&format!(
        "WITH feed AS (
           SELECT n.id FROM entities n
           WHERE NOT ({in_tree} AND instr(n.meta, char(10)) = 0)
           ORDER BY n.id DESC LIMIT ?1
         )
         SELECT {} FROM entities n
         LEFT JOIN edges l ON l.kind = 'link' AND l.source_id = n.id
         LEFT JOIN entities t ON t.id = l.target_id
         WHERE n.id IN (SELECT id FROM feed)
         ORDER BY n.id DESC, t.path",
        columns()
    ))?;
    let rows = stmt.query_map(params![limit], map_note_row)?;
    fold_tag_rows(rows)
}

/// 删除笔记(事务):删实体行(`edges` 外键级联出链/入链),
/// 最后精确回收"无出边且无 `link` 入边"的孤儿标签(父节点天生没有入边,旧实现的"无链接即孤儿"
/// 会连带删掉整棵子树)。
///
/// 注:统一元数据后不再有 `kind='note'`,按 id 直删(调用方只传笔记 id)。
pub fn delete(conn: &mut Connection, id: i64) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM entities WHERE id=?1", params![id])?;
    crate::db::repos::tags::gc_orphans(&tx)?;
    tx.commit()
}

/// 读取单条完整笔记(含 tagging 边全量标签的**完整路径**,按 path 升序);无该 id 返回 None。
/// 路径是树语义真源(同名末级可能出现在多个父级下),update/create 事务内共用。
pub(crate) fn read_full(conn: &Connection, id: i64) -> rusqlite::Result<Option<Note>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM entities n
         LEFT JOIN edges l ON l.kind = 'link' AND l.source_id = n.id
         LEFT JOIN entities t ON t.id = l.target_id
         WHERE n.id = ?1 ORDER BY t.path",
        columns()
    ))?;
    let rows = stmt.query_map(params![id], map_note_row)?;
    let mut note = fold_tag_rows(rows)?.into_iter().next();
    if let Some(n) = note.as_mut() {
        n.links = crate::db::repos::note_links::outbound_of(conn, n.id)?;
    }
    Ok(note)
}

/// `[[` 补全候选池的一项:笔记 id + 显示首行(与链接显示口径同源 [`display_title`])。
/// 字段名走 camelCase(前端 `NoteTitle` 类型同口径)。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteTitle {
    pub id: i64,
    pub title: String,
}

/// 有前缀时的候选上限:前端还要用 `scoreFuzzy` 精排取前 8,粗筛给足冗余即可。
pub const COMPLETE_NOTES_LIMIT: usize = 200;

/// 全部实体的**显示首行**(`links::display_title` 口径:只裁首尾空白、大小写与标签词元原样保留);
/// 首行剥标签后为空的不进池(统一元数据后 `[[ ]]` 补全池 = 全部实体,spec §5.1);按 id 升序。
pub fn all_titles(conn: &Connection) -> rusqlite::Result<Vec<NoteTitle>> {
    let mut stmt = conn.prepare("SELECT id, meta FROM entities ORDER BY id")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    let mut out = Vec::new();
    for row in rows {
        let (id, content) = row?;        let title = display_title(&content);
        if !title.is_empty() {
            out.push(NoteTitle { id, title });
        }
    }
    Ok(out)
}

/// 前缀粗筛(与 `tags::complete_fuzzy` 同手法):子串命中整档在前、子序列命中整档在后,
/// 档内保持传入顺序(池是 id 升序);**空前缀原样返回整池**(设计 N9:一次取回、前端按
/// `dataVersion` 会话内缓存),有前缀时截到 [`COMPLETE_NOTES_LIMIT`]。
pub fn pick_titles(pool: Vec<NoteTitle>, prefix: &str) -> Vec<NoteTitle> {
    if prefix.is_empty() {
        return pool;
    }
    let mut substr = Vec::new();
    let mut subseq = Vec::new();
    for t in pool {
        if t.title.contains(prefix) {
            substr.push(t);
        } else if is_subsequence(prefix, &t.title) {
            subseq.push(t);
        }
    }
    substr.extend(subseq);
    substr.truncate(COMPLETE_NOTES_LIMIT);
    substr
}

/// 词元是否为标题的**子序列**(字符按序出现即可;大小写不敏感,`/` 与 `\` 视同 ——
/// 与前端 `scoreFuzzy` / `tags::complete_fuzzy` 的匹配条件同一口径)。空词元恒 false。
fn is_subsequence(token: &str, title: &str) -> bool {
    let mut query = token.chars().flat_map(char::to_lowercase);
    let mut want = match query.next() {
        Some(c) => c,
        None => return false,
    };
    for cur in title.chars().flat_map(char::to_lowercase) {
        if cur == want || (is_sep(cur) && is_sep(want)) {
            match query.next() {
                Some(c) => want = c,
                None => return true,
            }
        }
    }
    false
}

fn is_sep(c: char) -> bool {
    c == '/' || c == '\\'
}
