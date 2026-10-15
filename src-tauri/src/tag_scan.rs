//! `#` 词元扫描(自 tags.rs 拆出以守 200 行红线):围栏/行内代码/转义 + 路径命中,
//! 命中之后按需消费一个名字组(关系语法 `#目标(名字)`,见 crate::tags::tag_name_group)。
//! 字符集、路径合法性与 `scan_tag_path` 仍以 tags.rs 为唯一真源。
use std::iter::Peekable;
use std::str::CharIndices;

use super::{consume_name_group, invalid_group_skip, scan_tag_path, NameGroup};

/// 确认合法的标签命中区间:start/end 为原文里的字节范围(含起始 '#'),path 为完整路径,
/// name 为名字组内容(None = 无名字组或空组 —— 两者语义相同)。
/// 有名字时区间含整组,于是剥离天然不留 `(名字)`(名字绝不落进正文的关键)。
#[derive(Debug, PartialEq)]
pub(crate) struct TagSpan {
    pub start: usize,
    pub end: usize,
    pub path: String,
    pub name: Option<String>,
}

/// 一条标签线:目标路径 + 可选关系名(首现序、按路径去重、名字组胜)。
/// 保存路径读的就是它(设计 §6.1);机器面(FTS/筛选/计数/导出)读的是路径投影。
#[derive(Debug, PartialEq)]
pub(crate) struct TagLine {
    pub path: String,
    pub name: Option<String>,
}

/// 严格提取(不带库内兜底):只有测试与共享向量断言用它;生产路径一律走 `parse_saved`。
#[cfg(test)]
pub fn extract_tags(content: &str) -> Vec<String> {
    extract_tags_known(content, &[])
}

/// 路径投影:只返回路径(首现序、按路径去重),**签名与语义都不变** —— 它是「机器面零变化」的
/// 结构性保证(FTS/筛选/计数/导出/回归基线走的就是它,名字不进这些面)。
pub(crate) fn extract_tags_known(content: &str, known: &[String]) -> Vec<String> {
    extract_lines_known(content, known).into_iter().map(|l| l.path).collect()
}

/// 词元投影(保存路径读的那一份):`#路径(名字)` -> 目标 + 名字。
/// 同一路径多次出现时**名字组胜**(有名压无名)、多个名字组**首现胜**(设计 §6.3 P2):
/// 于是 `#目标 #目标(国籍)` 与 `#目标(国籍) #目标` 都收敛成同一条有名线。
pub(crate) fn extract_lines_known(content: &str, known: &[String]) -> Vec<TagLine> {
    let mut out: Vec<TagLine> = Vec::new();
    for span in tag_spans_known(content, known) {
        match out.iter_mut().find(|l| l.path == span.path) {
            // 名字组胜:只有"先无后有"才补名字;两个名字组之间首现胜(不覆盖)
            Some(hit) => {
                if hit.name.is_none() {
                    hit.name = span.name;
                }
            }
            None => out.push(TagLine { path: span.path, name: span.name }),
        }
    }
    out
}

/// 扫描全文,返回所有确认合法的标签区间;剥离方(strip_tags)据此只删标签本身。
/// `known`(库内已存在的标签路径)用于**严格扫描失败**的位置做兜底(见 crate::tag_fallback)
pub(crate) fn tag_spans_known(content: &str, known: &[String]) -> Vec<TagSpan> {
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
            None => scan_line(content, offset, line, known, &mut spans),
        }
        offset += raw_line.len();
    }
    spans
}

/// 单行扫描:维护行内代码状态与转义,遇到可能的 '#' 起点交给 try_tag
fn scan_line(content: &str, base: usize, line: &str, known: &[String], out: &mut Vec<TagSpan>) {
    let mut in_code = false;
    let mut chars = line.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        match c {
            '\\' => {
                chars.next(); // 转义:反斜杠后的字符不作标签起点
            }
            '`' => in_code = !in_code,
            '#' if !in_code => try_tag(content, base, i, &mut chars, known, out),
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
    known: &[String],
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
    let rest: Vec<char> = chars.clone().map(|(_, c)| c).collect();
    // 严格语法优先;只有它在这里失败,才按"库内已存在的标签路径"兜底最长匹配
    // (兜底只认已存在的路径,不放宽语法、不新建节点,见 crate::tag_fallback)
    let hit = scan_tag_path(&rest, 0).or_else(|| crate::tag_fallback::longest_known(&rest, 0, known));
    let Some((raw, mut consumed)) = hit else {
        return; // 整串不合法且无可兜底的已存在路径:整串丢弃,不做部分提取,也不剥离字符
    };
    // 名字组(若紧贴路径)只在这里尝试一次:严格与兜底两条分支共用一处,
    // 于是 `…/[郴](chēn)州市(国籍)` 里兜底吃进 md 路径之后,最后那对括号才是名字。
    let mut name = None;
    match consume_name_group(&rest, consumed) {
        NameGroup::Absent => {}
        // 空组消费掉 `()`(语义 = 无名字,不因笔误删线)
        NameGroup::Empty => consumed += 2,
        NameGroup::Named(n) => {
            consumed += n.chars().count() + 2;
            name = Some(n);
        }
        // 组非空但非法/未闭合:整串不认(与 `#a//b` 同构)。名字组文本要一起跳过 ——
        // 否则组里的 `#` 会被外层扫描再认成标签起点,那正是设计禁止的「落部分结果」。
        NameGroup::Invalid => {
            // 跳过长度就是组文本尾后下标(共享迭代器此刻正停在 `#` 之后,与 `consumed` 同一起点)
            for _ in 0..invalid_group_skip(&rest, consumed) {
                chars.next();
            }
            return;
        }
    }
    // 同步推进共享的字符迭代器,并按字节算出区间终点
    let mut end = base + hash + 1;
    for _ in 0..consumed {
        let Some((j, n)) = chars.next() else { break };
        end = base + j + n.len_utf8();
    }
    out.push(TagSpan { start: base + hash, end, path: raw, name });
}

#[cfg(test)]
#[path = "tag_scan_tests.rs"]
mod tag_scan_tests;

// 解析真值表逐条用例(设计 §3.2 第 1-45 行)
#[cfg(test)]
#[path = "tag_scan_truth_tests.rs"]
mod tag_scan_truth_tests;
