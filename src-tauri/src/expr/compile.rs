//! 表达式 AST -> 针对笔记行 `n` 的布尔 SQL 片段(spec 3.2)。
//! 只产出固定谓词模板 + `?` 占位符,值按占位符次序推进 `args`:用户输入永不进入 SQL 文本。
//! 两种叶子谓词(标签 / 关键词)与结构化条件共用 [`crate::db::repos::notes::notes_filter`]
//! 的实现,不存在第二套语义;`NOT` 包住整个子片段(EXISTS 取反,无三值逻辑歧义)。
use rusqlite::types::Value;

use super::ast::Expr;
use crate::db::repos::notes::notes_filter::{keyword_predicate, tag_exists, tag_predicate};

/// 把 AST 编译成"笔记行 `n` 是否命中该表达式"的布尔片段
pub fn compile(e: &Expr, args: &mut Vec<Value>) -> String {
    match e {
        // 标签:`self_only`(即 `#=`)只比本级,否则含子级
        Expr::Tag { path, self_only } => tag_exists(&tag_predicate(path, *self_only, args)),
        // 空短语(`""`/纯空白)不是任何关键词:恒假,不给 FTS/LIKE 留下"匹配一切"的空模式
        Expr::Keyword(k) if k.trim().is_empty() => "0=1".to_string(),
        Expr::Keyword(k) => keyword_predicate(k, args),
        Expr::Not(inner) => format!("NOT ({})", compile(inner, args)),
        Expr::And(a, b) => format!("({} AND {})", compile(a, args), compile(b, args)),
        Expr::Or(a, b) => format!("({} OR {})", compile(a, args), compile(b, args)),
    }
}
