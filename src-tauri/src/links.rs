//! 笔记间显式链接 `[[标题]]` 的语法解析(设计 D1/D2/D9)。
//! 跳过口径与标签扫描(tags.rs::tag_spans_known)**完全一致**:围栏代码块整段跳过、
//! 行内代码(`)里不算、`\` 转义的下一个字符不作起点。区别只在终止:链接要 `[[` 与 `]]` 成对。
//! 正文里的 `[[X]]` **原样保留**(D7),本模块只回答"哪里是链接、标题是什么"。
use crate::db::repos::notes::strip_tags_known;

/// 一个已确认的链接区间:start/end 是原文里的**字节**范围(含 `[[` 与 `]]`),
/// raw_title 是裁过首尾空白的标题原文(匹配时才归一化)。
/// 字节范围目前只有测试在用(写入路径只取 raw_title);L2 渲染 chip 靠它切片定位,
/// 所以先放行 dead_code,而不是把字段删掉再加回来。
pub struct LinkSpan {
    #[allow(dead_code)]
    pub start: usize,
    #[allow(dead_code)]
    pub end: usize,
    pub raw_title: String,
}

/// 标题长度上限(字符数,非字节):超长的整串保持字面(设计 §3 语法约束)
pub const MAX_TITLE_CHARS: usize = 200;

/// 扫描全文,返回所有确认合法的链接区间。
/// 逐行维护围栏状态(与 tags.rs::tag_spans_known 同款结构):围栏内的行整段不看,
/// 围栏外的行再走 scan_line 处理行内代码与转义。
pub fn link_spans(content: &str) -> Vec<LinkSpan> {
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
            None => scan_line(line, offset, &mut spans),
        }
        offset += raw_line.len();
    }
    spans
}

/// 单行扫描:维护行内代码状态与转义,遇到 `[[` 交给 parse_at。
/// 这里按**字节**推进是安全的:只有 ASCII 的 `[` `]` `\` `` ` `` 触发分支,
/// 多字节字符的续字节不可能等于它们。
fn scan_line(line: &str, base: usize, out: &mut Vec<LinkSpan>) {
    let bytes = line.as_bytes();
    let mut in_code = false;
    let mut i = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2, // 转义:反斜杠后的一个字符不作链接起点
            b'`' => {
                in_code = !in_code;
                i += 1;
            }
            b'[' if !in_code && bytes.get(i + 1) == Some(&b'[') => match parse_at(line, i) {
                Some((end, raw_title)) => {
                    out.push(LinkSpan { start: base + i, end: base + end, raw_title });
                    i = end;
                }
                // 整串不算:跳到闭合 `]]` 之后 —— 里面的那个 `[[` 不再重启
                // (向量「嵌套整串不算」`[[甲[[乙]]` 必须得到空)
                None => i = skip_past_close(line, i + 2),
            },
            _ => i += 1,
        }
    }
}

/// 在 `line[open..]`(open 指向首个 `[`)尝试解析一条链接:
/// 成功返回 (结束字节下标 = 闭 `]]` 之后, 裁过首尾空白的标题)。
fn parse_at(line: &str, open: usize) -> Option<(usize, String)> {
    let rest = &line[open + 2..];
    let close = rest.find("]]")?;
    let raw = rest[..close].trim();
    if raw.is_empty() || raw.chars().count() > MAX_TITLE_CHARS || raw.contains(['[', ']']) {
        return None;
    }
    Some((open + 2 + close + 2, raw.to_string()))
}

/// 从 `from` 起跳过第一个 `]]`;没有闭合就跳到行尾(整串字面保留,不解析)
fn skip_past_close(line: &str, from: usize) -> usize {
    match line[from..].find("]]") {
        Some(rel) => from + rel + 2,
        None => line.len(),
    }
}

/// 首行归一化:先剥掉行内的 `#标签` 词元(复用保存路径同一解析器,口径天然一致),
/// 再折叠连续空白并转 ASCII 小写 —— 结果用于 A 方案的首行等值匹配(D2)。
/// 单行输入串天然不在围栏里,故没有围栏状态;`strip_tags_known` 已折叠空白,这里再统一一次。
pub fn normalize_title(line: &str) -> String {
    strip_tags_known(line, &[])
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

/// 取正文第一条非空行并归一化;整条都是空白时返回空串(与"没有标题"同义)
pub fn title_of(content: &str) -> String {
    content
        .lines()
        .find(|l| !l.trim().is_empty())
        .map(normalize_title)
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "links_tests.rs"]
mod links_tests;
