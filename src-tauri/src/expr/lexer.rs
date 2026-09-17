//! 表达式词法(spec 3.1):字符流 -> token 流;纯函数,错误带字符下标定位。
//! 位置约定:`pos` 是**字符下标**(Unicode 字符数,不是字节数),指向出错 token 的
//! **第一个字符**(标签指向 `#`、短语指向开引号、日期比较指向 `date`)。
//! 裸 `&`/`|`/`!` 会终止关键词(要当字面量请用引号包起来)。
//! 日期比较(`date>=...`)已整体取消(spec 2026-09-17 D2):词法阶段即给明确中文报错,
//! 不再产出日期 token;单独出现的 `date` 仍是普通关键词。
//! 扫描细节在 lexer_scan.rs;本文件只保留公共 API 与 token 定义,便于文本级改写按
//! 起止下标定位([`lex_spans`])。

/// 扫描实现(循环 + 各 token 读法);子模块拆出后本文件仍守 200 行上限
#[path = "lexer_scan.rs"]
mod lexer_scan;

/// 词法 token
#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    /// 标签;`self_only` 为真表示 `#=路径`(仅本级),否则 `#路径`(含子级)
    Tag { path: String, self_only: bool },
    /// 关键词(裸词或引号短语)
    Keyword(String),
    And,
    Or,
    Not,
    LParen,
    RParen,
}

/// 词法/语法错误;`pos` 为出错 token 首字符的**字符下标**(Unicode 字符数,不是字节数)
#[derive(Debug, Clone, PartialEq)]
pub struct ExprError {
    pub message: String,
    pub pos: usize,
}

impl ExprError {
    pub(crate) fn new(message: impl Into<String>, pos: usize) -> Self {
        Self { message: message.into(), pos }
    }
}

/// 带位置的 token:(首字符下标, token)
pub(crate) type PositionedToken = (usize, Token);

/// 词法入口:只返回 token 序列(位置信息由 [`lex_spans`] / lex_with_pos 提供)
pub fn lex(input: &str) -> Result<Vec<Token>, ExprError> {
    Ok(lex_spans(input)?.into_iter().map(|(t, _, _)| t).collect())
}

/// 词法(带起止下标):`(token, 首字符下标, 尾后字符下标)`,与 [`lex`] 同一遍扫描。
/// 尾后下标即替换区间的右开端点,供 tabs_state 里表达式的文本级改写使用。
pub fn lex_spans(input: &str) -> Result<Vec<(Token, usize, usize)>, ExprError> {
    Ok(lexer_scan::scan(input)?
        .into_iter()
        .map(|(start, end, t)| (t, start, end))
        .collect())
}

/// 词法(只留首字符下标):供 parser 报错定位,与 [`lex_spans`] 同源
pub(crate) fn lex_with_pos(input: &str) -> Result<Vec<PositionedToken>, ExprError> {
    Ok(lexer_scan::scan(input)?
        .into_iter()
        .map(|(start, _, t)| (start, t))
        .collect())
}
