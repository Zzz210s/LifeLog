//! 正文标签的**兜底解析**(2026-09-26 T6 / tag-label-md):严格扫描失败的 `#` 处,
//! 在库内**已存在的标签路径**里做最长匹配。只认已存在的路径 —— 不放宽正文语法
//! ([`crate::tags::parse_tag_path`] 一个字没改)、不新建节点、不猜。
//!
//! 为什么需要:UI 编辑态回显的是**原始路径**(`#[郴](chēn)州市`),md 名字里的 `[`
//! 不在正文名称字符集里,严格扫描在那里截断 —— 标签会被替换语义删掉,md 源码则被写进正文
//! (复现用例见 `db::repos::notes_save_fallback_tests`)。
//!
//! 与 `crate::tags` 的分工:那边管"严格语法"(什么算标签、`#` 的前导规则、代码块/转义),
//! 这里只管"严格失败之后,这段文本是不是某个**已存在**标签的路径"。唯一调用点是
//! `tags::try_tag`,候选由保存路径从库里取(`notes::known_tag_paths`)。
use crate::tags::is_tag_char;

/// 在 `chars[start..]` 上按 `known` 做**最长匹配**,返回 `(路径, 消耗的字符数)`。
/// 命中条件三条(缺一不可):
/// ① 候选是那段文本的前缀(逐字符比对,天然按 UTF-8 边界);
/// ② 命中之后紧跟的字符既不是名称字符也不是 `/` —— 否则用户写的是更长的、库里没有的路径,
///    宁可不认(不猜、不做部分剥离:`#a/b/x` 不会因为 `a/b` 存在而被剥成 `/x`);
/// ③ 取满足①②的**最长**候选。
///
/// 两条**已知边界**(实测过,属设计内副产品,刻意不修):
/// - 后缀多一个非名称字符仍算命中:`#…/[郴](chēn)州市]`(尾部多一个 `]`)会命中该路径
///   并把 `]` 留在正文 —— 规则②只看紧跟前缀的那一个字符,不往回看尾部标点;这是
///   「标点是正常终止符」的既有口径在 md 路径上的自然延伸。
/// - 库里没有的**更深**路径整串不认:`#…/宜章县/额外` 在 `…/宜章县` 处被规则②拦下,
///   整个 `#` 词元不是标签(若笔记原先链着该标签,替换语义下会把它删掉)——
///   与修复前一致,只是现在不再猜。
pub(crate) fn longest_known(
    chars: &[char],
    start: usize,
    known: &[String],
) -> Option<(String, usize)> {
    let mut best: Option<(String, usize)> = None;
    for path in known {
        let n = path.chars().count();
        if n == 0 || start + n > chars.len() || best.as_ref().is_some_and(|(_, b)| n <= *b) {
            continue;
        }
        if !path.chars().eq(chars[start..start + n].iter().copied()) {
            continue;
        }
        match chars.get(start + n) {
            Some(&c) if is_tag_char(c) || c == '/' => continue,
            _ => best = Some((path.clone(), n)),
        }
    }
    best
}

#[cfg(test)]
#[path = "tag_fallback_tests.rs"]
mod tag_fallback_tests;
