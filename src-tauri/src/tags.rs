//! 标签语法解析(spec 3.3.1):严格名称字符集 + Markdown 感知 + 整串判定。
//! 终止规则:空白与标点一律正常终止标签(标签有效、后随字符留在正文);
//! 只有结构非法(空段/首尾或连续斜杠/深度超限/# 后无名称字符)才整串丢弃。
//! 不符合语法的一律当普通文本原样保留 —— 不建标签,也不剥离任何字符。
use std::iter::Peekable;
use std::str::CharIndices;

/// 层级深度上限(节点数)
const MAX_DEPTH: usize = 5;

/// 标签名允许的字符:中文、字母、数字、下划线、连字符;
/// `/` 仅作层级分隔,其它标点、空白与 emoji 都不算名称字符
pub fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-'
}

/// 允许出现在名称**内部**的分隔标点:仅当其后紧跟名称字符时才算名称的一部分。
/// 于是 `v1.0` 是标签,而 `工作.` 句末的句点仍是终止符(标签为 `工作`)。
pub fn is_inner_punct(c: char) -> bool {
    c == '.' || c == '·'
}

/// 单段合法性:非空;`.`/`·` 只允许夹在名称字符之间(前后都必须是名称字符)。
fn valid_segment(seg: &str) -> bool {
    if seg.is_empty() {
        return false;
    }
    let mut prev_name = false;
    let mut chars = seg.chars().peekable();
    while let Some(c) = chars.next() {
        if is_tag_char(c) {
            prev_name = true;
            continue;
        }
        let next_name = matches!(chars.peek(), Some(n) if is_tag_char(*n));
        if is_inner_punct(c) && prev_name && next_name {
            prev_name = false;
            continue;
        }
        return false;
    }
    true
}

/// 深度上限(供调用方与测试读取)
pub fn max_depth() -> usize {
    MAX_DEPTH
}

/// 校验并切分标签路径:空串、非法字符、空段、首尾或连续斜杠、超过深度都返回 None
pub fn parse_tag_path(raw: &str) -> Option<Vec<String>> {
    let parts: Vec<&str> = raw.split('/').collect();
    if parts.len() > max_depth() || parts.iter().any(|p| !valid_segment(p)) {
        return None;
    }
    Some(parts.into_iter().map(str::to_string).collect())
}

/// 确认合法的标签命中区间:start/end 为原文里的字节范围(含起始 '#'),path 为完整路径
pub(crate) struct TagSpan {
    pub start: usize,
    pub end: usize,
    pub path: String,
}

/// 提取标签:返回完整路径字符串,去重并保持出现顺序
pub fn extract_tags(content: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for span in tag_spans(content) {
        if !out.contains(&span.path) {
            out.push(span.path);
        }
    }
    out
}

/// 扫描全文,返回所有确认合法的标签区间;剥离方(strip_tags)据此只删标签本身
pub(crate) fn tag_spans(content: &str) -> Vec<TagSpan> {
    let mut spans = Vec::new();
    let mut fence: Option<&str> = None;
    let mut offset = 0usize;
    for raw_line in content.split_inclusive('\n') {
        let line = raw_line.strip_suffix('\n').unwrap_or(raw_line);
        let line = line.strip_suffix('\r').unwrap_or(line);
        let trimmed = line.trim_start();
        match fence {
            // 围栏代码块内整段跳过,直到同种围栏闭合
            Some(marker) => {
                if trimmed.starts_with(marker) {
                    fence = None;
                }
            }
            None if trimmed.starts_with("```") => fence = Some("```"),
            None if trimmed.starts_with("~~~") => fence = Some("~~~"),
            None => scan_line(content, offset, line, &mut spans),
        }
        offset += raw_line.len();
    }
    spans
}

/// 单行扫描:维护行内代码状态与转义,遇到可能的 '#' 起点交给 try_tag
fn scan_line(content: &str, base: usize, line: &str, out: &mut Vec<TagSpan>) {
    let mut in_code = false;
    let mut chars = line.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        match c {
            '\\' => {
                chars.next(); // 转义:反斜杠后的字符不作标签起点
            }
            '`' => in_code = !in_code,
            '#' if !in_code => try_tag(content, base, i, &mut chars, out),
            _ => {}
        }
    }
}

/// 在 '#' 处尝试解析:查前导字符 -> 排除 Markdown 标题 -> 收名称与 '/' -> 整串校验。
/// 收名称时遇到空白/标点即停(正常终止,标签仍有效);只有整串结构非法才丢弃。
fn try_tag(
    content: &str,
    base: usize,
    hash: usize,
    chars: &mut Peekable<CharIndices<'_>>,
    out: &mut Vec<TagSpan>,
) {
    // 前导字符规则:'#' 前若是 ASCII 字母数字或 '#'/'&',不视为标签(C#、URL 片段、HTML 实体)
    if content[..base + hash]
        .chars()
        .next_back()
        .is_some_and(|p| p.is_ascii_alphanumeric() || matches!(p, '#' | '&'))
    {
        return;
    }
    match chars.peek() {
        None => return,                              // 裸 '#' 收尾
        Some((_, n)) if n.is_whitespace() => return, // Markdown 标题标记,跳过该 '#'
        _ => {}
    }
    let mut raw = String::new();
    let mut end = base + hash + 1;
    while let Some(&(j, n)) = chars.peek() {
        if is_tag_char(n) || n == '/' {
            raw.push(n);
            end = base + j + n.len_utf8();
            chars.next();
        } else if is_inner_punct(n) {
            // `.`/`·` 只有后一个字符仍是名称字符时才并入名称,否则当终止符(保留在正文)
            let mut probe = chars.clone();
            probe.next();
            if !matches!(probe.peek(), Some(&(_, c)) if is_tag_char(c)) {
                break;
            }
            raw.push(n);
            end = base + j + n.len_utf8();
            chars.next();
        } else {
            break;
        }
    }
    if parse_tag_path(&raw).is_none() {
        return; // 整串不合法:整串丢弃,不做部分提取,也不剥离字符
    }
    out.push(TagSpan { start: base + hash, end, path: raw });
}

#[cfg(test)]
#[path = "tags_tests.rs"]
mod tags_tests;
