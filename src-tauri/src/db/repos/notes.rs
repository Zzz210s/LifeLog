use rusqlite::{params, Connection};
use serde::Serialize;

/// 笔记(流查询与单条读回的统一结构)。
/// `created_at` 是物理列(保留不删),但已零业务用途(D2)—— 时间一律看 `date`(取自时间标签)。
#[derive(Serialize, Debug)]
pub struct Note {
    pub id: i64,
    pub content: String,
    pub created_at: String,
    /// 时间标签的日期(`YYYY-MM-DD`);无时间标签为 None
    pub date: Option<String>,
    /// 时间标签节点 id(供界面改期时按 id 寻址)
    pub date_tag_id: Option<i64>,
    pub tags: Vec<String>,
}

/// 单行空白归一:保留行首空格/制表符(markdown 缩进语义),仅把行内连续空白折叠为一个空格,
/// 行尾空白丢弃;纯空白行归一为空行,保持空行结构
fn collapse_line(line: &str) -> String {
    let indent_len = line.len() - line.trim_start_matches([' ', '\t']).len();
    let (indent, rest) = line.split_at(indent_len);
    let body = rest.split_whitespace().collect::<Vec<_>>().join(" ");
    if body.is_empty() {
        String::new()
    } else {
        format!("{indent}{body}")
    }
}

/// 存库前移除 #标签 词元:用 `tags::tag_spans`(与 extract_tags 同一解析器)定位
/// **确认合法**的标签区间并只剥离这些区间;结构非法的 # 写法(如 `#工作/`、`#a//b`、`##标题`、
/// 行内/围栏代码块里的 #、`\#`)整串原样保留;空白/标点只是正常终止标签,不使其作废。
/// 起始于行首或紧跟空白之后的标签,额外吞掉其后的连续空格/制表符(不吞换行);
/// 最后逐行归一空白并保留行结构与行首缩进(多行笔记的换行、空行、嵌套列表缩进原样保留;
/// 标签折叠进 tags/tag_links,原文保留会双重展示)
pub(crate) fn strip_tags(content: &str) -> String {
    let content = content.replace("\r\n", "\n"); // 统一换行,防 Windows 端混入 \r
    let mut out = String::new();
    let mut cursor = 0usize;
    for span in crate::tags::tag_spans(&content) {
        out.push_str(&content[cursor..span.start]);
        // 仅当标签起始于行首或紧跟空白之后,才吞掉其后的连续空格/制表符:
        // 行首标签剥离后不留残余空白被误当缩进;
        // 行中标签(前面是词或标点)必须保留分隔空白,否则 "a-#tag b" 会粘连成 "a-b"、
        // "版本(#v2 备注)" 会粘连成 "版本(备注)",相邻文本被并成一个词(语义被改)。
        // 只吞空格/制表符,不吞换行,否则会把下一行并上来。
        let leading = out.chars().next_back().is_none_or(char::is_whitespace);
        cursor = span.end;
        if leading {
            while matches!(content[cursor..].chars().next(), Some(' ' | '\t')) {
                cursor += 1;
            }
        }
    }
    out.push_str(&content[cursor..]);
    out.split('\n').map(collapse_line).collect::<Vec<_>>().join("\n")
}

/// 新建笔记(事务):剥离/提取正文标签 -> 链接 -> 追加当天时间标签 `时间排序/YYYY/MM/DD`。
/// 输入栏与主窗 Composer 保存共用此路径;时间标签与笔记同事务落库(要么都在,要么都不在)。
/// 用户手打的同路径标签由 link_paths 先建过,ensure_path 只会复用同一节点。
pub fn create(conn: &mut Connection, content: &str) -> rusqlite::Result<Note> {
    let today = crate::timetag::today_local(conn)?;
    create_with(conn, content, Some(&today))
}

/// 仅测试用:构造不含时间标签的笔记(008 之前的形态),供既有标签行为与回填用例
#[cfg(test)]
pub(crate) fn create_plain(conn: &mut Connection, content: &str) -> rusqlite::Result<Note> {
    create_with(conn, content, None)
}

/// 仅测试用:构造带指定日期时间标签的笔记(排序/筛选/导出用例需要确定的日期)
#[cfg(test)]
pub(crate) fn create_on(conn: &mut Connection, content: &str, date: &str) -> rusqlite::Result<Note> {
    create_with(conn, content, Some(date))
}

/// 创建事务内核:`date` 为 `YYYY-MM-DD`(None = 不加时间标签;日期非法时同样不加)
fn create_with(conn: &mut Connection, content: &str, date: Option<&str>) -> rusqlite::Result<Note> {
    let names = crate::tags::extract_tags(content);
    let text = strip_tags(content);
    let tx = conn.transaction()?;
    tx.execute("INSERT INTO notes(content) VALUES(?1)", params![text])?;
    let id = tx.last_insert_rowid();
    // 006 起 tags 为树:按路径自动建父级并做增量链接(孤儿回收已收窄为"无链接且无子")
    crate::db::repos::tags_tree::link_paths(&tx, id, &names)?;
    if let Some(segs) = date.and_then(crate::timetag::segments_for_date) {
        let tag_id = crate::db::repos::tags_tree::ensure_path(&tx, &segs)?;
        crate::db::repos::tags_tree::link_note(&tx, id, tag_id)?;
    }
    let note = read_full(&tx, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
    tx.commit()?;
    Ok(note)
}

/// 笔记读取与行映射(自 notes.rs 拆出以守 200 行上限):read_full/recent/delete + 时间标签列
#[path = "notes_read.rs"]
pub mod notes_read;
#[cfg(test)]
pub(crate) use notes_read::recent;
pub(crate) use notes_read::{fold_tag_rows, map_note_row, read_full};
pub use notes_read::delete;

/// 条件对象(结构化筛选真源)与条件 -> SQL 片段生成 / 校验
#[path = "notes_filter.rs"]
pub mod notes_filter;
pub use notes_filter::{validate as validate_conditions, FilterConditions};

/// 查询/更新拆分模块(守 200 行上限);re-export 保持 repos::notes::* 路径不变
#[path = "notes_query.rs"]
pub mod notes_query;
pub use notes_query::query;

#[path = "notes_update.rs"]
pub mod notes_update;
pub use notes_update::{toggle_todo, update};

#[path = "notes_date.rs"]
pub mod notes_date;
pub use notes_date::set_date;

#[cfg(test)]
#[path = "notes_filter_tests.rs"]
mod notes_filter_tests;

#[cfg(test)]
#[path = "notes_tests.rs"]
mod notes_tests;

#[cfg(test)]
#[path = "notes_time_tests.rs"]
mod notes_time_tests;

#[cfg(test)]
#[path = "notes_date_tests.rs"]
mod notes_date_tests;

#[cfg(test)]
#[path = "notes_strip_tests.rs"]
mod notes_strip_tests;
