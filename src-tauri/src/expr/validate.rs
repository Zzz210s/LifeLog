//! 表达式校验(spec 3.3):空 -> 长度 -> 项数 -> 语法,逐级短路。
//! 上限与文案真源是 [`super::MAX_LEN`]/[`super::MAX_TOKENS`];错误位置沿用 lexer/parser 的
//! **字符下标**约定,绝不在这里改写,以免与前端「第 N 个字符」提示错位。
use super::ast::Expr;
use super::lexer::{lex, ExprError};
use super::parser::parse;
use super::{MAX_LEN, MAX_TOKENS};

/// 校验表达式并返回 AST(合法时)。
/// 顺序:①空白 -> 「表达式为空」②字符数超 [`MAX_LEN`] ③token 数超 [`MAX_TOKENS`]
/// ④词法/语法(括号深度、缺操作数等由 lexer/parser 给出中文原因与位置)。
pub fn validate(input: &str) -> Result<Expr, ExprError> {
    if input.trim().is_empty() {
        return Err(ExprError::new("表达式为空", 0));
    }
    if input.chars().count() > MAX_LEN {
        return Err(ExprError::new(format!("表达式最多 {MAX_LEN} 字符"), 0));
    }
    if lex(input)?.len() > MAX_TOKENS {
        return Err(ExprError::new(format!("表达式项数超过上限 {MAX_TOKENS}"), 0));
    }
    parse(input)
}
