//! 标签名的**界面口径**(名称校验 / 整条路径校验),以及解析口径的再导出。
//!
//! 拆成两个文件只为守 200 行红线:tokenizer 与 `label_plain` 移到了 `tag_label_plain.rs`,
//! 这里只留界面改名与筛选条件用的两条校验,并把解析口径里**调用方要用**的那个名字再导出
//! (`tag_label::label_plain` 的调用点因此一处不用改;token 形态只有测试要看,
//! 它们直接从 `crate::tag_label_plain` 取,免得再导出触发未用导入告警)。
//!
//! 两套口径的分工:这里的 `validate_*` 是界面口径(md 友好),正文 `#` 语法仍走
//! `tags::parse_tag_path`(严格名称字符集,一个字不改)。

pub use crate::tag_label_plain::label_plain;

/// 界面改名的名称字符数上限(正文语法无长度上限;这是 UI 输入面的护栏)
pub const MAX_LABEL_CHARS: usize = 100;

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

#[cfg(test)]
#[path = "tag_label_tests.rs"]
mod tag_label_tests;
