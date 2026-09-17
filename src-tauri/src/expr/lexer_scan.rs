//! 表达式词法扫描实现(自 lexer.rs 拆出以守 200 行上限):字符流 -> `(首字符下标,
//! 尾后字符下标, token)`,纯函数。公共 API(Token/ExprError/lex/lex_spans)在 lexer.rs,
//! 位置口径(`pos` 与下标均为 Unicode 字符数、0 起)见那边的模块说明。
use super::{ExprError, Token};
use crate::expr::{DATE_REMOVED, QUOTE_UNCLOSED, TAG_PATH_INVALID};

/// 关键词终止字符:空白、括号、引号或符号运算符的起始字符
fn is_kw_break(c: char) -> bool {
    c.is_whitespace() || matches!(c, '(' | ')' | '"' | '!' | '&' | '|')
}

/// 扫描:返回每个 token 的 `(首字符下标, 尾后字符下标, token)`;跳过空白,原样保留下标。
/// 起止下标供文本级改写(`rewrite_expr_paths`)定位替换区间,与 parser 报错位置同源。
pub(super) fn scan(input: &str) -> Result<Vec<(usize, usize, Token)>, ExprError> {
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0usize;
    let mut out: Vec<(usize, usize, Token)> = Vec::new();
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
                // 日期比较已取消:识别到 `date` + 比较运算符就给明确中文报错(位置指向 `date`),
                // 而不是当成两个关键词让用户看不出所以然
                if is_date_comparison(&chars, i) {
                    return Err(ExprError::new(DATE_REMOVED, i));
                }
                let (tok, next) = read_word(&chars, i);
                i = next;
                tok
            }
        };
        out.push((start, i, token));
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

/// 是否是已取消的日期比较写法:`date` + 可选空白 + (`>=` `<=` `>` `<` `=`)。
/// 只认小写 `date`(`date >= X` 与 `date>= X` 等价);命中即由调用方报中文错误。
fn is_date_comparison(chars: &[char], start: usize) -> bool {
    if chars.len() < start + 5 || chars[start..start + 4] != ['d', 'a', 't', 'e'] {
        return false;
    }
    let mut i = start + 4;
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    matches!(chars.get(i), Some('>' | '<' | '='))
}
