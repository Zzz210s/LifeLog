//! 表达式词法(spec 3.1):字符流 -> token 流;纯函数,错误带字符下标定位。
//! 位置约定:`pos` 是**字符下标**(Unicode 字符数,不是字节数),指向出错 token 的
//! **第一个字符**(标签指向 `#`、短语指向开引号、日期指向日期字面量首字符)。
//! 裸 `&`/`|`/`!` 会终止关键词(要当字面量请用引号包起来);日期比较目前只认小写 `date`
//! (`date >= X` 与 `date>= X` 等价,运算符两侧都允许空白)。
use super::ast::DateOp;
use super::{DATE_INVALID, QUOTE_UNCLOSED, TAG_PATH_INVALID};

/// 词法 token
#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    /// 标签;`self_only` 为真表示 `#=路径`(仅本级),否则 `#路径`(含子级)
    Tag { path: String, self_only: bool },
    /// 关键词(裸词或引号短语)
    Keyword(String),
    /// 日期比较
    Date { op: DateOp, date: String },
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

/// 关键词终止字符:空白、括号、引号或符号运算符的起始字符
fn is_kw_break(c: char) -> bool {
    c.is_whitespace() || matches!(c, '(' | ')' | '"' | '!' | '&' | '|')
}

/// 带位置的 token:(首字符下标, token)
pub(crate) type PositionedToken = (usize, Token);

/// 词法入口:只返回 token 序列(位置信息由 lex_with_pos 提供)
pub fn lex(input: &str) -> Result<Vec<Token>, ExprError> {
    Ok(lex_with_pos(input)?.into_iter().map(|(_, t)| t).collect())
}

/// 词法:返回 `(首字符下标, token)` 序列,供 parser 复用同一套字符下标
pub(crate) fn lex_with_pos(input: &str) -> Result<Vec<PositionedToken>, ExprError> {
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0usize;
    let mut out: Vec<PositionedToken> = Vec::new();
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        let start = i;
        let token = match c {
            '(' => {
                i += 1;
                Token::LParen
            }
            ')' => {
                i += 1;
                Token::RParen
            }
            '&' if chars.get(i + 1) == Some(&'&') => {
                i += 2;
                Token::And
            }
            '|' if chars.get(i + 1) == Some(&'|') => {
                i += 2;
                Token::Or
            }
            '!' => {
                i += 1;
                Token::Not
            }
            '"' => {
                let (kw, next) = read_quoted(&chars, i)?;
                i = next;
                Token::Keyword(kw)
            }
            '#' => {
                let (tok, next) = read_tag(&chars, i)?;
                i = next;
                tok
            }
            _ => {
                // `date` 只有紧跟比较运算符时才是日期;否则按裸词处理
                if let Some((tok, next)) = try_read_date(&chars, i)? {
                    i = next;
                    tok
                } else {
                    let (tok, next) = read_word(&chars, i);
                    i = next;
                    tok
                }
            }
        };
        out.push((start, token));
    }
    Ok(out)
}

/// 引号短语:读到未转义的 `"` 为止,内部 `\"` 还原为 `"`;未闭合则报开引号位置
fn read_quoted(chars: &[char], start: usize) -> Result<(String, usize), ExprError> {
    let mut out = String::new();
    let mut i = start + 1;
    while i < chars.len() {
        match chars[i] {
            '\\' if chars.get(i + 1) == Some(&'"') => {
                out.push('"');
                i += 2;
            }
            '"' => return Ok((out, i + 1)),
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    Err(ExprError::new(QUOTE_UNCLOSED, start))
}

/// 标签:`#=` 为仅本级,`#` 为含子级;路径字符集、内嵌标点与合法性与正文抽标签共用
/// [`crate::tags::scan_tag_path`](标签语法的唯一真源),失败报 `#` 位置。
/// 与正文的差异:正文里句末的 `#工作.` 只取 `工作`(句点留给正文),表达式里则整串判非法
/// —— 否则 `#工作.` 会被静默切成「标签 工作 + 关键词 .」,用户看不出自己打错了。
fn read_tag(chars: &[char], start: usize) -> Result<(Token, usize), ExprError> {
    let mut i = start + 1;
    let self_only = chars.get(i) == Some(&'=');
    if self_only {
        i += 1;
    }
    let Some((path, next)) = crate::tags::scan_tag_path(chars, i) else {
        return Err(ExprError::new(TAG_PATH_INVALID, start));
    };
    if matches!(chars.get(next), Some(&c) if crate::tags::is_inner_punct(c)) {
        return Err(ExprError::new(TAG_PATH_INVALID, start));
    }
    Ok((Token::Tag { path, self_only }, next))
}

/// 裸词:连续非 break 字符;与 AND/OR/NOT 整词(大小写不敏感)相等则为运算符,否则关键词
fn read_word(chars: &[char], start: usize) -> (Token, usize) {
    let mut end = start;
    while end < chars.len() && !is_kw_break(chars[end]) {
        end += 1;
    }
    // 落单的 '&' / '|' 不构成运算符,按单字符关键词收下,避免空词原地打转
    let end = if end == start { start + 1 } else { end };
    let raw: String = chars[start..end].iter().collect();
    let token = match raw.to_uppercase().as_str() {
        "AND" => Token::And,
        "OR" => Token::Or,
        "NOT" => Token::Not,
        _ => Token::Keyword(raw),
    };
    (token, end)
}

/// 日期比较:`date` + (`>=` `<=` `>` `<` `=`)+ `YYYY-MM-DD`;
/// 不是日期写法则返回 None 交由裸词处理;字面量非法报字面量首字符位置
fn try_read_date(chars: &[char], start: usize) -> Result<Option<(Token, usize)>, ExprError> {
    if chars.len() < start + 4 || chars[start..start + 4] != ['d', 'a', 't', 'e'] {
        return Ok(None);
    }
    let mut i = start + 4;
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    let (op, mut lit_start) = match chars.get(i) {
        Some('>') if chars.get(i + 1) == Some(&'=') => (DateOp::Ge, i + 2),
        Some('<') if chars.get(i + 1) == Some(&'=') => (DateOp::Le, i + 2),
        Some('>') => (DateOp::Gt, i + 1),
        Some('<') => (DateOp::Lt, i + 1),
        Some('=') => (DateOp::Eq, i + 1),
        _ => return Ok(None),
    };
    // 运算符之后的空白同样跳过(`date >= 2026-09-01`),否则容忍度不对称
    while lit_start < chars.len() && chars[lit_start].is_whitespace() {
        lit_start += 1;
    }
    let mut j = lit_start;
    while j < chars.len() && !is_kw_break(chars[j]) {
        j += 1;
    }
    let date: String = chars[lit_start..j].iter().collect();
    if !crate::timetag::is_iso_date(&date) {
        return Err(ExprError::new(DATE_INVALID, lit_start));
    }
    Ok(Some((Token::Date { op, date }, j)))
}
