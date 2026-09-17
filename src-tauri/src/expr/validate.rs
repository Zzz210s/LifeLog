//! 表达式校验(spec 3.3):空 -> 长度 -> 项数 -> 语法 -> 空短语,逐级短路。
//! 上限与文案真源是 [`super::MAX_LEN`]/[`super::MAX_TOKENS`];错误位置沿用 lexer/parser 的
//! **字符下标**(0 起)约定,绝不在这里改写,以免与前端「第 N 个字符」提示错位。
use super::ast::Expr;
use super::lexer::{lex, lex_with_pos, ExprError, Token};
use super::parser::parse;
use super::{MAX_LEN, MAX_TOKENS, QUOTE_EMPTY};

/// 校验表达式并返回 AST(合法时)。
/// 顺序:①空白 -> 「表达式为空」②字符数超 [`MAX_LEN`] ③token 数超 [`MAX_TOKENS`]
/// ④词法/语法(括号深度、缺操作数等由 lexer/parser 给出中文原因与位置)
/// ⑤引号内为空 —— 语法合法但既不预览也不命中任何笔记,必须拦掉。
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
    let ast = parse(input)?;
    if has_blank_phrase(&ast) {
        // 位置取该短语 token 的**首字符下标**(0 起,与前端提示同一口径);
        // 走带位置的词法只为定位,解析已在上一步成功
        let pos = lex_with_pos(input)?
            .into_iter()
            .find(|(_, t)| matches!(t, Token::Keyword(k) if k.trim().is_empty()))
            .map_or(0, |(pos, _)| pos);
        return Err(ExprError::new(QUOTE_EMPTY, pos));
    }
    Ok(ast)
}

/// AST 里是否存在引号内容为空的短语(裸词不可能为空,只有 `""`/`"   "` 会产生)
fn has_blank_phrase(e: &Expr) -> bool {
    match e {
        Expr::Keyword(k) => k.trim().is_empty(),
        Expr::Tag { .. } => false,
        Expr::Not(inner) => has_blank_phrase(inner),
        Expr::And(a, b) | Expr::Or(a, b) => has_blank_phrase(a) || has_blank_phrase(b),
    }
}
