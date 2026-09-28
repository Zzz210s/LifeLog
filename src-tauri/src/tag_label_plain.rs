//! 标签名行内 markdown 的**解析口径**(tokenizer + `label_plain`)。
//!
//! 与前端 `src/shared/tag-label-plain.ts` 的 `parseTagLabel` / `tagLabelPlain` **逐条一致**,
//! 由共享向量 `fixtures/tag-label.json` 两侧共读钉住;任一方改了语法,两条测试同时红。
//!
//! 语法收得很窄(标签名不是文档):链接 / 粗体 / 斜体 / 下划线强调 / 删除线 / 行内代码 /
//! 反斜杠转义。`_` 强调带 flanking 守卫(`a_b_c`、`snake_case`、`工作__重点__` 保持字面),
//! `*` 保持宽松;非法、未闭合、嵌套一律**逐字退化**(不猜后半段、不递归内层)。
//! **不做实体解码**:`&amp;` 保持字面 —— 这里无依赖做实体表,而它又是 FTS / 别名 / 导出的
//! 真源,与正文(markdown-it 会解码)有意不同。
//!
//! 从 `tag_label.rs` 拆出只为守 200 行红线:名字仍由那边的 `pub use` 提供,调用方
//! (`tags::label_plain`、`db::sql_functions`、`exchange::notes_export`)一处不用改。

/// 行内 token(与前端 `TagLabelToken` 同构;`text` 即可见文本)
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LabelToken {
    Text(String),
    Link { text: String, title: String },
    Strong(String),
    Em(String),
    Del(String),
    Code(String),
}

/// 取 `s[at..]` 里连续的、"不是 stop 字符"的字节长度(可能为 0)
fn run_until(s: &str, stop: impl Fn(char) -> bool, at: usize) -> usize {
    let mut n = 0;
    for c in s[at..].chars() {
        if stop(c) {
            break;
        }
        n += c.len_utf8();
    }
    n
}

/// `s[at..]` 的第一个字符(用于右侧守卫与转义看后一个字符)
fn char_at(s: &str, at: usize) -> Option<char> {
    s[at..].chars().next()
}

/// 守卫用的类别判定(与前端 `\p{L}\p{N}` / `\s` 同口径;含 CJK)
fn word(c: Option<char>) -> bool {
    c.is_some_and(char::is_alphanumeric)
}
fn blank(c: Option<char>) -> bool {
    c.is_some_and(char::is_whitespace)
}

/// 反斜杠可转义的字符(与前端 `ESCAPABLE` 同一集合;正文转义一切标点,这里更窄)
fn is_escapable(c: char) -> bool {
    matches!(c, '\\' | '*' | '_' | '`' | '[' | ']')
}

/// 下划线强调的 flanking 守卫(对齐 markdown-it 的判定;`*` 的宽松行为不受此约束):
/// 开定界符左侧不得是字母/数字、右侧不得是空白;收定界符右侧不得是字母/数字、左侧不得是空白。
/// 没有它,`a_b_c` / `snake_case` / `工作_重点_` 会被吃掉 —— 这些是真实标签名里最常见的形态。
fn flank_ok(raw: &str, at: usize, run: usize, opening: bool) -> bool {
    let left = raw[..at].chars().next_back();
    let right = char_at(raw, at + run);
    if opening {
        !word(left) && !blank(right)
    } else {
        !word(right) && !blank(left)
    }
}

/// 「成对定界符」取形:剥 `delim`,取最长不含 `stop` 的非空串,再要求紧跟 `closing`;
/// 返回(内容, 整段字节数)。粗体 / 斜体 / 删除线 / 行内代码四者只差定界符,故共用这一个。
fn pair<'a>(s: &'a str, delim: &str, stop: char, closing: &str) -> Option<(&'a str, usize)> {
    let body = s.strip_prefix(delim)?;
    let n = run_until(body, |c| c == stop, 0);
    if n == 0 || !body[n..].starts_with(closing) {
        return None;
    }
    Some((&body[..n], delim.len() + n + closing.len()))
}

/// 下划线强调 `__x__`(run=2,粗体)/ `_x_`(run=1,斜体):先取形,再由 [`flank_ok`] 决定收不收
fn match_under(raw: &str, at: usize, run: usize) -> Option<(LabelToken, usize)> {
    let delim = if run == 2 { "__" } else { "_" };
    let body = raw[at..].strip_prefix(delim)?;
    let n = run_until(body, |c| c == '_', 0);
    if n == 0 || !body[n..].starts_with(delim) {
        return None;
    }
    if !flank_ok(raw, at, run, true) || !flank_ok(raw, at + run + n, run, false) {
        return None;
    }
    let text = body[..n].to_string();
    let token = if run == 2 { LabelToken::Strong(text) } else { LabelToken::Em(text) };
    Some((token, 2 * run + n))
}

/// 行内代码 `` `x` ``(与前端 sticky 正则同解)
fn match_code(s: &str) -> Option<(LabelToken, usize)> {
    let (body, n) = pair(s, "`", '`', "`")?;
    Some((LabelToken::Code(body.to_string()), n))
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

/// 就地尝试各语法(等价于前端 sticky 正则:失败不向后搜索)。
/// 取 `raw` + 下标(而非切片)是因为下划线的守卫要看**左侧**那个字符;
/// 删除线没有 flanking 约束(与正文 GFM 一致:词内 `x~~y~~z` 也生效)。
fn match_at(raw: &str, at: usize) -> Option<(LabelToken, usize)> {
    let s = &raw[at..];
    let strong = pair(s, "**", '*', "**").map(|(t, n)| (LabelToken::Strong(t.to_string()), n));
    let em = pair(s, "*", '*', "*").map(|(t, n)| (LabelToken::Em(t.to_string()), n));
    match raw.as_bytes()[at] {
        b'*' => strong.or(em),
        b'_' => match_under(raw, at, 2).or_else(|| match_under(raw, at, 1)),
        b'~' => pair(s, "~~", '~', "~~").map(|(t, n)| (LabelToken::Del(t.to_string()), n)),
        b'`' => match_code(s),
        b'[' => match_link(s),
        _ => None,
    }
}

/// 行内 token 序列(唯一解析入口,与前端 `parseTagLabel` 同构)
pub fn parse_label(raw: &str) -> Vec<LabelToken> {
    let mut out: Vec<LabelToken> = Vec::new();
    let mut buf = String::new();
    let mut i = 0usize;
    while i < raw.len() {
        let c = raw[i..].chars().next().expect("i 落在字符边界上");
        if c == '\\' {
            match char_at(raw, i + 1).filter(|n| is_escapable(*n)) {
                Some(next) => {
                    buf.push(next);
                    i += 1 + next.len_utf8();
                }
                None => {
                    buf.push(c);
                    i += 1;
                }
            }
            continue;
        }
        let step = match match_at(raw, i) {
            Some((token, len)) => {
                if !buf.is_empty() {
                    out.push(LabelToken::Text(std::mem::take(&mut buf)));
                }
                out.push(token);
                len
            }
            // 失败的强调/代码/删除线:整串同一字符当字面量吞掉(前端 runOf 同口径),绝不半解析
            None if matches!(c, '*' | '`' | '~' | '_') => {
                let n: usize =
                    raw[i..].chars().take_while(|x| *x == c).map(|x| x.len_utf8()).sum();
                buf.push_str(&raw[i..i + n]);
                n
            }
            None => {
                buf.push(c);
                c.len_utf8()
            }
        };
        i += step;
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
        LabelToken::Text(s)
        | LabelToken::Strong(s)
        | LabelToken::Em(s)
        | LabelToken::Del(s)
        | LabelToken::Code(s) => s,
        LabelToken::Link { text, .. } => text,
    }
}
