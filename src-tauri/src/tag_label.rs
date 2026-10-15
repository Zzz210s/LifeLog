//! 标签名的**界面口径**(名称校验 / 整条路径校验 / 关系名校验)与解析产物的对外投影
//! (token 序列 / 跨度 / 纯文本)。
//!
//! 拆成两个文件只为守 200 行红线:token 语法本体在 `tag_label_plain.rs`,这里按区间重投影,
//! 好让「哪些括号被行内 md 链接消费掉了」这类判定有跨度可依(见 `tag_label_paren.rs`)。
//! `tag_label::label_plain` 的调用点因此一处不用改。
//!
//! 两套口径的分工:这里的 `validate_*` 是界面口径(md 友好),正文 `#` 语法仍走
//! `tags::parse_tag_path`(严格名称字符集,一个字不改);而 `validate_relation_name`
//! 恰恰**反过来**用正文语法 —— 关系名是 `#目标(名字)` 里那段文本,能写回源码才算合法(P6)。

use crate::tag_label_plain::{tokenize, LabelToken};

/// 行内 token 及其在原文里的字节跨度(`start..end`;token 序列连续铺满整串,不留缝)
pub struct LabelSpan {
    pub token: LabelToken,
    pub start: usize,
    pub end: usize,
}

/// 行内 token 序列与各自跨度(`parse_label` 是它的投影;要按区间判定的调用方取这个)
pub fn parse_label_spans(raw: &str) -> Vec<LabelSpan> {
    let mut start = 0usize;
    tokenize(raw)
        .into_iter()
        .map(|(end, token)| {
            let span = LabelSpan { token, start, end };
            start = end;
            span
        })
        .collect()
}

/// 行内 token 序列(唯一解析入口,与前端 `parseTagLabel` 同构)
pub fn parse_label(raw: &str) -> Vec<LabelToken> {
    tokenize(raw).into_iter().map(|(_, t)| t).collect()
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

#[path = "tag_label_paren.rs"]
mod tag_label_paren;

/// 界面改名的名称字符数上限(正文语法无长度上限;这是 UI 输入面的护栏)
pub const MAX_LABEL_CHARS: usize = 100;

/// 界面改名用的单段名称校验(与正文语法**不同**:允许 md 符号)。
/// 拒绝:空名、含 `/`(界面口径:名字必须单段)、控制字符、空白、`#`(正文里到不了)、
/// **裸括号**(`#工作(重要)` 会与名字组分不清,设计 §3.4)、超长。
/// 控制字符 / 空白 / `#` / 裸括号都是"名字落库却永远无法被正文无歧义引用"的形态,故与空名同等对待。
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
    if tag_label_paren::has_bare_paren(name) {
        return Err("标签名不能包含裸括号:括号只能作为行内 md 链接 [显示](备注) 的一部分".into());
    }
    if name.chars().count() > MAX_LABEL_CHARS {
        return Err(format!("标签名过长:最多 {MAX_LABEL_CHARS} 字符"));
    }
    Ok(())
}

/// 整条标签路径的**界面口径**校验(md 友好):按 `/` 切段、逐段走 [`validate_label`] ——
/// 允许段内 md 符号(`地点/[郴](chēn)州市`),结构规则不变;**层级深度不设上限**
/// (2026-09-28 起取消 5 层上限)。
/// **正文 `#` 语法不受影响**:那里仍走 `tags::parse_tag_path`。
/// 筛选条件里的标签路径(点侧栏标签加条件)与界面改名共用这一份口径。
pub fn validate_tag_path(path: &str) -> Result<(), String> {
    for seg in path.split('/') {
        validate_label(seg)?;
    }
    Ok(())
}

/// 关系名(名字组文本)的合法性:与正文语法**同源** —— 能不能写成 `#目标(名字)`,
/// 由 `tags::parse_tag_path` 说了算(允许 `/`,P5;名字点 `meta` 也允许 `/`)。
/// 面板能造出的名字必须是源码写得出来的,否则往返必然丢名字(P6);
/// 长度沿用界面输入面的护栏(P10:语法不设上限,输入面 100)。
pub fn validate_relation_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("关系名不能为空".into());
    }
    if name.chars().count() > MAX_LABEL_CHARS {
        return Err(format!("关系名过长:最多 {MAX_LABEL_CHARS} 字符"));
    }
    if crate::tags::parse_tag_path(name).is_none() {
        return Err("关系名不合法:只能由名称字符(字母/数字/中文/下划线/连字符)与 / 组成".into());
    }
    Ok(())
}

#[cfg(test)]
#[path = "tag_label_tests.rs"]
mod tag_label_tests;

#[cfg(test)]
#[path = "tag_label_valid_tests.rs"]
mod tag_label_valid_tests;
