//! 解析笔记源码命令:**与保存路径共用同一实现**(`db::repos::notes::parse_saved`),
//! 是"源码 -> 正文 + 标签集合"的唯一真源。
//! 前端编辑面板靠它实时显示标签数,绝不自己复制一份标签语法(再写一份等于把漂移固化);
//! 复用保存路径同时意味着**库内已存在的 md 形态路径**(`#[郴](chēn)州市` 这类,
//! 严格正文语法吃不下的)在这里同样被认出 —— 否则面板会对同一段源码显示「标签 0 个」,
//! 与保存结果自相矛盾。
use crate::db::Db;
use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

/// 解析结果:保存后的正文(`content`)与按首现去重的标签完整路径(`tags`)
#[derive(Serialize, Debug, PartialEq)]
pub struct ParseResult {
    pub content: String,
    pub tags: Vec<String>,
}

/// 源码 -> 保存后的正文 + 标签集合(带库连接的可测内核)。
/// 直接调 `notes::parse_saved` —— create/update 用的就是它,命令不另起一份口径。
pub fn parse_source(conn: &Connection, source: &str) -> rusqlite::Result<ParseResult> {
    let (tags, content) = crate::db::repos::notes::parse_saved(conn, source)?;
    Ok(ParseResult { content, tags })
}

/// IPC 入口:库不可用(锁中毒 / SQL 错)时返回 Err,前端回退"已保存标签数"不拦保存。
#[tauri::command]
pub fn parse_note_source(db: State<Db>, source: String) -> Result<ParseResult, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    parse_source(&conn, &source).map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "parse_tests.rs"]
mod parse_tests;
