//! 名字组扫描(spec 2026-10-15 §3.3):`#目标(名字)` 里紧贴路径之后的那对括号。
//! 四态一次给出:无组 / 空组 / 有名字 / 非法。「非法」= 组非空但内容不满足 `parse_tag_path`
//! (含空白、`#`、嵌套 `(`、首尾标点、末尾 `.`、转义、未闭合)⇒ 整串不认,与 `#a//b` 同构:
//! 不落部分结果、不猜。组内容与路径**同一份**字符集与结构判定,tags.rs 是唯一真源。
use super::{is_inner_punct, is_tag_char, parse_tag_path};

/// 名字组的四种结局;调用方(`try_tag`)的动作见 `tag_scan::try_tag`:
/// `Absent` 不消费;`Empty`/`Named` 消费到 `)` 为止;`Invalid` 让整个 `#` 词元作废
#[derive(Debug, PartialEq)]
pub(crate) enum NameGroup {
    /// `at` 处不是 `(`(含全角括号)
    Absent,
    /// `()` 立刻闭合:合法,语义 = 无名字
    Empty,
    /// `(合法名字)`:名字可与路径一样含 `/` 与内嵌 `.`/`·`
    Named(String),
    /// 组非空但非法,或未闭合
    Invalid,
}

/// 组内文本的字符集扫描:返回 (读掉的文本, 停下时的下标)。
/// 停下处正好是 `)` 才算闭合;是别的字符就说明组非空但非法。
/// `consume_name_group` 与 `invalid_group_skip` 共用这一个循环 —— 字符集只有一份。
fn scan_group_text(input: &[char], at: usize) -> (String, usize) {
    let mut i = at + 1;
    let mut raw = String::new();
    while let Some(&c) = input.get(i) {
        let punct_ok = is_inner_punct(c) && matches!(input.get(i + 1), Some(&n) if is_tag_char(n));
        if is_tag_char(c) || c == '/' || punct_ok {
            raw.push(c);
            i += 1;
        } else {
            break;
        }
    }
    (raw, i)
}

/// 从 `input[at]`(`(` 的位置)起消费一个名字组。组内文本与路径同一份规则:
/// `is_tag_char` ∪ `/` ∪ 内嵌 `.`/`·`,停在第一个不符合的字符;
/// 只有「停下的那个字符正好是 `)`」且组内文本本身过 `parse_tag_path`(非空、段非空、
/// 首尾标点非法)才算合法闭合。
pub(crate) fn consume_name_group(input: &[char], at: usize) -> NameGroup {
    if input.get(at) != Some(&'(') {
        return NameGroup::Absent;
    }
    if input.get(at + 1) == Some(&')') {
        return NameGroup::Empty;
    }
    let (raw, stop) = scan_group_text(input, at);
    if input.get(stop) != Some(&')') || parse_tag_path(&raw).is_none() {
        return NameGroup::Invalid;
    }
    NameGroup::Named(raw)
}

/// `Invalid` 时应跳过的组文本尾后下标:组内读掉的内容 + 让它停下的那个字符
/// (停下处是 `)` 则连 `)` 一起跳过;停在行尾则无可跳)。
/// 整串不认时必须跳过 —— 否则组里的 `#` 会被外层扫描再认成一个标签起点,
/// 那正是设计禁止的「落部分结果」;跳过只覆盖组文本,组外文本(含同行后续的合法标签)不受影响。
pub(crate) fn invalid_group_skip(input: &[char], at: usize) -> usize {
    let (_, stop) = scan_group_text(input, at);
    if stop < input.len() {
        stop + 1
    } else {
        stop
    }
}

#[cfg(test)]
#[path = "tag_name_group_tests.rs"]
mod tag_name_group_tests;
