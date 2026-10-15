//! 标签语法解析(spec 3.3.1 + 2026-10-15 关系语法 `#目标(名字)`):严格名称字符集 + Markdown 感知 + 整串判定。
//! 终止规则:空白与标点一律正常终止标签(标签有效、后随字符留在正文);
//! 只有结构非法(空段/首尾或连续斜杠/# 后无名称字符)才整串丢弃。
//! 层级深度**不设上限**(2026-09-28 起取消 5 层上限):段数只按结构判定。
//! 本文件只留**字符集与路径判定**这两份真源;`#` 词元扫描(围栏/行内代码/名字组)在 tag_scan.rs,
//! 名字组四态扫描器在 tag_name_group.rs —— 两个子模块经 #[path] 挂在这里并再导出,
//! 因此调用点仍走 `crate::tags::…`(lib.rs 不动)。

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

// 界面改名与筛选条件的名称放宽 + md 纯文本形态(T2/T3):实现在 tag_label.rs(本文件已近 200 行红线),
// 经这里上浮成 `tags::label_plain` / `tags::validate_label` / `tags::validate_tag_path`。
// 注意与 parse_tag_path 的分工:正文 `#` 语法保持严格,放开的只是界面改名。
pub use crate::tag_label::{label_plain, validate_label, validate_tag_path};
// 上限常量只被两侧的测试读(前端有同名口径);非测试构建引用会报未用导入,与 tree::complete 同理
#[cfg(test)]
pub use crate::tag_label::MAX_LABEL_CHARS;

/// 校验并切分标签路径:空串、非法字符、空段、首尾或连续斜杠都返回 None(层级深度不设上限)
pub fn parse_tag_path(raw: &str) -> Option<Vec<String>> {
    let parts: Vec<&str> = raw.split('/').collect();
    if parts.iter().any(|p| !valid_segment(p)) {
        return None;
    }
    Some(parts.into_iter().map(str::to_string).collect())
}

/// 扫描 `#` 之后的标签路径候选(`input` 是字符流,`start` 指向 `#` 之后的首字符):
/// 返回 `(路径, 结束下标)`。名称字符与内嵌标点规则是本文件的:`/` 只作分层,
/// `.`/`·` 只有后随名称字符时才并入名称(`v1.0` 的句点是名称,`工作.` 的句点终止);
/// 整串不合法(空段/首尾标点)返回 None。表达式词法(#/`#=`)与正文抽标签
/// 共用这一个扫描器,不各自维护第二套字符集。
pub(crate) fn scan_tag_path(input: &[char], start: usize) -> Option<(String, usize)> {
    let mut i = start;
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
    parse_tag_path(&raw).map(|_| (raw, i))
}

// `#` 词元扫描与名字组扫描器:两个子模块挂在本文件下(沿用 tags_tests.rs 的 #[path] 手法),
// 再导出后调用点仍是 `crate::tags::{tag_spans_known, extract_lines_known, TagLine, …}`。
#[path = "tag_scan.rs"]
mod tag_scan;
#[path = "tag_name_group.rs"]
mod tag_name_group;

pub(crate) use tag_name_group::{consume_name_group, invalid_group_skip, NameGroup};
pub(crate) use tag_scan::{extract_lines_known, extract_tags_known, tag_spans_known, TagLine, TagSpan};
// 「严格提取」是测试与共享向量专用的路径投影入口(生产一律走 `parse_saved`)
#[cfg(test)]
pub(crate) use tag_scan::extract_tags;

#[cfg(test)]
#[path = "tags_tests.rs"]
mod tags_tests;

// 共享测试向量(仓库根 fixtures/tag-grammar.json)的 Rust 侧断言
#[cfg(test)]
#[path = "tags_fixtures_tests.rs"]
mod tags_fixtures_tests;

// 名线存在与否不改变 `tag_plain` 与 FTS 聚合的守卫(设计 §7.2;文件在 tags/ 子目录)
#[cfg(test)]
#[path = "tags/tag_plain_unchanged_tests.rs"]
mod tag_plain_unchanged_tests;
