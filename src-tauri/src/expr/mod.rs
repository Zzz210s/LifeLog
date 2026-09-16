//! 表达式逃生舱的纯逻辑层(spec 3.1-3.3):词法 -> 语法 -> AST。
//! 不触数据库、不碰前端;所有错误位置 `pos` 均为**字符下标**(Unicode 字符数,非字节数)。

pub mod ast;
pub mod lexer;
pub mod parser;

#[cfg(test)]
#[path = "lexer_tests.rs"]
mod lexer_tests;

#[cfg(test)]
#[path = "parser_tests.rs"]
mod parser_tests;

/// 表达式原文长度上限(字符数)
pub const MAX_LEN: usize = 500;
/// token 数上限
pub const MAX_TOKENS: usize = 100;
/// 词法错误文案(界面直接展示;引号短语未闭合)
pub const QUOTE_UNCLOSED: &str = "引号没有闭合";
/// 词法错误文案:日期字面量非法
pub const DATE_INVALID: &str = "日期格式不正确(应为 YYYY-MM-DD)";
/// 词法错误文案:标签路径非法(合法性由 tags::parse_tag_path 判定,此处只补原因文案)
pub const TAG_PATH_INVALID: &str = "标签路径不合法(只允许中文/字母/数字/下划线/连字符,用 / 分层)";

/// 括号嵌套层数上限
pub const MAX_DEPTH: usize = 10;
