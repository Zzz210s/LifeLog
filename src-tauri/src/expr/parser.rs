//! 表达式语法(spec 3.1):递归下降,优先级 NOT > AND > OR,括号覆盖优先级。
//! 位置同样用**字符下标**;token 耗尽时报原文长度(错误指向表达式末尾)。
//! 日期比较已取消(D2),叶子只有标签与关键词两种。
use super::ast::Expr;
use super::lexer::{lex_with_pos, ExprError, PositionedToken, Token};
use super::MAX_DEPTH;

/// 解析入口:词法 -> 语法 -> AST
pub fn parse(input: &str) -> Result<Expr, ExprError> {
    let toks = lex_with_pos(input)?;
    if toks.is_empty() {
        return Err(ExprError::new("表达式为空", 0));
    }
    let eof = input.chars().count();
    let mut parser = Parser { toks, i: 0, depth: 0, eof };
    let expr = parser.or_expr()?;
    match parser.remaining() {
        None => Ok(expr),
        Some((pos, true)) => Err(ExprError::new("多余的右括号", pos)),
        Some((pos, false)) => Err(ExprError::new("缺少操作数", pos)),
    }
}

/// 递归下降状态机;`depth` 只统计 `(` 嵌套层数
struct Parser {
    toks: Vec<PositionedToken>,
    i: usize,
    depth: usize,
    eof: usize,
}

impl Parser {
    /// 尚未消费的首个 token:返回 (位置, 是否为右括号)
    fn remaining(&self) -> Option<(usize, bool)> {
        self.toks.get(self.i).map(|(pos, t)| (*pos, matches!(t, Token::RParen)))
    }

    /// 当前 token 的位置;已耗尽时取原文长度(报错指向末尾)
    fn pos(&self) -> usize {
        self.toks.get(self.i).map_or(self.eof, |(pos, _)| *pos)
    }

    /// or_expr := and_expr (OR and_expr)*
    fn or_expr(&mut self) -> Result<Expr, ExprError> {
        let mut left = self.and_expr()?;
        while self.take(Token::Or) {
            let right = self.and_expr()?;
            left = Expr::Or(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    /// and_expr := not_expr (AND not_expr)*
    fn and_expr(&mut self) -> Result<Expr, ExprError> {
        let mut left = self.not_expr()?;
        while self.take(Token::And) {
            let right = self.not_expr()?;
            left = Expr::And(Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    /// not_expr := NOT not_expr | primary(右结合,优先级最高)
    fn not_expr(&mut self) -> Result<Expr, ExprError> {
        if self.take(Token::Not) {
            return Ok(Expr::Not(Box::new(self.not_expr()?)));
        }
        self.primary()
    }

    /// primary := LPAREN or_expr RParen | Tag | Keyword
    fn primary(&mut self) -> Result<Expr, ExprError> {
        let pos = self.pos();
        let Some(token) = self.toks.get(self.i).map(|(_, t)| t.clone()) else {
            return Err(ExprError::new("缺少操作数", pos));
        };
        match token {
            Token::LParen => {
                self.i += 1;
                self.depth += 1;
                if self.depth > MAX_DEPTH {
                    return Err(ExprError::new("嵌套层数超过上限 10", pos));
                }
                let inner = self.or_expr()?;
                if !matches!(self.remaining(), Some((_, true))) {
                    return Err(ExprError::new("缺少右括号", self.pos()));
                }
                self.i += 1;
                self.depth -= 1;
                Ok(inner)
            }
            Token::Tag { path, self_only } => {
                self.i += 1;
                Ok(Expr::Tag { path, self_only })
            }
            Token::Keyword(kw) => {
                self.i += 1;
                Ok(Expr::Keyword(kw))
            }
            Token::RParen | Token::And | Token::Or | Token::Not => {
                Err(ExprError::new("缺少操作数", pos))
            }
        }
    }

    /// 消费一个期望的单字符运算符 token,成功返回 true
    fn take(&mut self, want: Token) -> bool {
        if self.toks.get(self.i).is_some_and(|(_, t)| *t == want) {
            self.i += 1;
            true
        } else {
            false
        }
    }
}
