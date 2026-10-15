//! 「标签名不得包含裸括号」的谓词(设计 §3.4,语法成立的**前提**)。
//!
//! 名字组的定界符就是 `(`:若段名里能自由出现 `(`,`#工作(重要)` 就有两种读法 ——
//! 目标 `工作` + 名字 `重要`,还是目标就叫 `工作(重要)`?那要回溯或最长匹配去猜,
//! 才是真正的「把漂移固化」。故段名文本里每个 `(`/`)` 都必须由行内 md 链接记号
//! `[显示](备注)` 消费掉;剩下的一律非法。md 形态照旧放行 —— 真库唯一含括号的段名
//! 就是 md 形态 `[郴](chēn)州市`(设计 §0/§7.4:存量 0 违规,不需要数据修复)。
//!
//! 判定**复用** `tag_label_plain` 的 tokenizer(不写第二份括号语法):只有落在
//! **Link token 区间内**的括号才算被消费。于是 `**a(b)**` / `` `a(b)` `` 里的括号仍是裸的 ——
//! tokenizer 不递归内层,粗体/代码 token 里的 `](…)` 只是字面文本,不是链接记号。
//!
//! 与前端镜像 `src/shared/tag-label-paren.ts` 同源(`has_bare_paren` / `hasBareParen`),
//! 两侧用例同表,任一方改了判据同时红。

use crate::tag_label::{parse_label_spans, LabelSpan};
use crate::tag_label_plain::LabelToken;

/// 名字文本里是否含**裸括号**(不属于任何行内 md 链接记号的 `(` / `)`)
pub fn has_bare_paren(raw: &str) -> bool {
    let links: Vec<LabelSpan> = parse_label_spans(raw)
        .into_iter()
        .filter(|s| matches!(s.token, LabelToken::Link { .. }))
        .collect();
    raw.char_indices().any(|(i, c)| {
        matches!(c, '(' | ')') && !links.iter().any(|s| s.start <= i && i < s.end)
    })
}

#[cfg(test)]
#[path = "tag_label_paren_tests.rs"]
mod tag_label_paren_tests;
