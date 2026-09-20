//! 解析笔记源码命令:与保存路径**共用同一实现**,是"源码 -> 正文 + 标签集合"的唯一真源。
//! 前端编辑面板靠它实时显示标签数,绝不自己复制一份标签语法(再写一份等于把漂移固化)。
use serde::Serialize;

/// 解析结果:保存后的正文(`content`)与按首现去重的标签完整路径(`tags`)
#[derive(Serialize, Debug, PartialEq)]
pub struct ParseResult {
    pub content: String,
    pub tags: Vec<String>,
}

/// 解析笔记源码 -> 保存后的正文 + 标签集合。
/// 两个函数就是保存路径本尊:`tags::extract_tags`(create/update 用它抽标签)
/// 与 `db::repos::notes::strip_tags`(create/update 用它剥标签),此处只做薄封装。
#[tauri::command]
pub fn parse_note_source(source: String) -> ParseResult {
    ParseResult {
        tags: crate::tags::extract_tags(&source),
        content: crate::db::repos::notes::strip_tags(&source),
    }
}

#[cfg(test)]
#[path = "parse_tests.rs"]
mod parse_tests;
