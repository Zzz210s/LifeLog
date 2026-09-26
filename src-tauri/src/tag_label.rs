//! 标签名的行内 markdown(T1 spec 2026-09-26):**纯文本形态**与**界面改名**的名称校验。
//!
//! 与前端 `src/shared/tag-label.ts` 的 `tagLabelPlain` **逐条一致**(共享向量
//! `fixtures/tag-label.json`,两侧测试读同一份文件):`[郴](chēn)州市` -> `郴州市`。
//! 语法范围与前端一样窄 —— 链接 / 粗体 / 斜体 / 行内代码四种;非法、未闭合、嵌套
//! 一律**逐字退化**(不猜后半段、不递归内层)。
//!
//! 本模块只管"显示出来的标签名",**不碰正文 `#` 语法**:正文抽标签仍走
//! `tags::parse_tag_path`(严格名称字符集,一个字不改)。
//!
//! 从 tags.rs 拆出:那里已接近 200 行红线,且这里两件事同源(都读"名字里的 md")。

/// 界面改名的名称字符数上限(正文语法无长度上限;这是 UI 输入面的护栏)
pub const MAX_LABEL_CHARS: usize = 100;

/// 行内 token(与前端 `TagLabelToken` 同构;`text` 即可见文本)
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LabelToken {
    Text(String),
    Link { text: String, title: String },
    Strong(String),
    Em(String),
    Code(String),
}

/// 取 `s[at..]` 里连续的、"不是 stop 字符"的字节长度(可能为 0)
fn run_until(s: &str, stop: fn(char) -> bool, at: usize) -> usize {
    let mut n = 0;
    for c in s[at..].chars() {
        if stop(c) {
            break;
        }
        n += c.len_utf8();
    }
    n
}

/// 粗体 `**x**`:`**` 后取最长非 `*` 串(至少 1 个)且紧跟 `**`(与前端 sticky 正则同解)
fn match_strong(s: &str) -> Option<(LabelToken, usize)> {
    let body = s.strip_prefix("**")?;
    let n = run_until(body, |c| c == '*', 0);
    if n == 0 || !body[n..].starts_with("**") {
        return None;
    }
    Some((LabelToken::Strong(body[..n].to_string()), 4 + n))
}

/// 斜体 `*x*`(在粗体之后尝试)
fn match_em(s: &str) -> Option<(LabelToken, usize)> {
    let body = s.strip_prefix('*')?;
    let n = run_until(body, |c| c == '*', 0);
    if n == 0 || !body[n..].starts_with('*') {
        return None;
    }
    Some((LabelToken::Em(body[..n].to_string()), 2 + n))
}

/// 行内代码 `` `x` ``
fn match_code(s: &str) -> Option<(LabelToken, usize)> {
    let body = s.strip_prefix('`')?;
    let n = run_until(body, |c| c == '`', 0);
    if n == 0 || !body[n..].starts_with('`') {
        return None;
    }
    Some((LabelToken::Code(body[..n].to_string()), 2 + n))
}

/// 链接 `[文本](悬浮内容)`:文本非空且不含 `[`/`]`;悬浮内容可空且不含 `(`/`)`
fn match_link(s: &str) -> Option<(LabelToken, usize)> {
    let body = s.strip_prefix('[')?;
    let n = run_until(body, |c| c == '[' || c == ']', 0);
    if n == 0 {
        return None;
    }
    let after = body[n..].strip_prefix(']')?.strip_prefix('(')?;
    let m = run_until(after, |c| c == '(' || c == ')', 0);
    after[m..].strip_prefix(')')?;
    let token = LabelToken::Link { text: body[..n].to_string(), title: after[..m].to_string() };
    Some((token, 4 + n + m))
}

/// 就地尝试四种语法(等价于前端 sticky 正则:失败不向后搜索),返回 token 与字节长度
fn match_at(s: &str) -> Option<(LabelToken, usize)> {
    match s.as_bytes()[0] {
        b'*' => match_strong(s).or_else(|| match_em(s)),
        b'`' => match_code(s),
        b'[' => match_link(s),
        _ => None,
    }
}

/// 行内 token 序列(唯一解析入口,与前端 `parseTagLabel` 同构)
pub fn parse_label(raw: &str) -> Vec<LabelToken> {
    let mut out: Vec<LabelToken> = Vec::new();
    let mut buf = String::new();
    let mut rest = raw;
    while let Some(c) = rest.chars().next() {
        let step = match match_at(rest) {
            Some((token, len)) => {
                if !buf.is_empty() {
                    out.push(LabelToken::Text(std::mem::take(&mut buf)));
                }
                out.push(token);
                len
            }
            // 失败的强调/代码:整串同一字符当字面量吞掉(前端 runOf 同口径),绝不半解析
            None if c == '*' || c == '`' => {
                let n: usize = rest.chars().take_while(|x| *x == c).map(|x| x.len_utf8()).sum();
                buf.push_str(&rest[..n]);
                n
            }
            None => {
                buf.push(c);
                c.len_utf8()
            }
        };
        rest = &rest[step..];
    }
    if !buf.is_empty() {
        out.push(LabelToken::Text(buf));
    }
    out
}

/// 去掉 md 语法后的可见文本(空串原样返回空串)
pub fn label_plain(raw: &str) -> String {
    parse_label(raw).iter().map(token_text).collect()
}

/// 单条 token 的可见文本(链接取 `[ ]` 内文本,不取悬浮内容)
fn token_text(t: &LabelToken) -> &str {
    match t {
        LabelToken::Text(s) | LabelToken::Strong(s) | LabelToken::Em(s) | LabelToken::Code(s) => s,
        LabelToken::Link { text, .. } => text,
    }
}

/// 界面改名用的单段名称校验(与正文语法**不同**:允许 md 符号)。
/// 拒绝:空名、含 `/`(名字必须单段)、控制字符、空白、`#`(正文里到不了)、超长。
/// 后三条都是"名字落库却永远无法被正文引用"的形态,故与空名同等对待。
pub fn validate_label(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("标签名不能为空".into());
    }
    if name.contains('/') {
        return Err("标签名不能包含 /(名字必须是单段)".into());
    }
    if name.chars().any(char::is_control) {
        return Err("标签名不能包含控制字符".into());
    }
    if name.chars().any(char::is_whitespace) {
        return Err("标签名不能包含空白字符".into());
    }
    if name.contains('#') {
        return Err("标签名不能包含 #".into());
    }
    if name.chars().count() > MAX_LABEL_CHARS {
        return Err(format!("标签名过长:最多 {MAX_LABEL_CHARS} 字符"));
    }
    Ok(())
}

/// 整条标签路径的**界面口径**校验(md 友好):按 `/` 切段、段数 ≤ `tags::max_depth()`,
/// 逐段走 [`validate_label`] —— 允许段内 md 符号(`地点/[郴](chēn)州市`),结构规则不变。
/// **正文 `#` 语法不受影响**:那里仍走 `tags::parse_tag_path`,一个字不改。
/// 筛选条件里的标签路径(点侧栏标签加条件)与界面改名共用这一份口径。
pub fn validate_tag_path(path: &str) -> Result<(), String> {
    let depth = crate::tags::max_depth();
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() > depth {
        return Err(format!("标签层级最多 {depth} 层"));
    }
    for seg in parts {
        validate_label(seg)?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "tag_label_tests.rs"]
mod tag_label_tests;
