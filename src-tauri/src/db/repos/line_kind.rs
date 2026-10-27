//! 线语义的 Rust 侧词汇表(架构精简 A,2026-10-27)。
//!
//! 三条视图在迁移 033 里定义:
//! - `tag_lines`       无名线(`name_id IS NULL`)= 打标签 / `[[ ]]` 链接
//! - `tree_lines`      子级线(`name_id = 0`)= 树(保留名字点「子级」)
//! - `relation_lines`  有名线(声明了属性名的引用)
//! - `non_tree_lines`  非结构线 = 引用 / 关系(树线与"引用别人"互斥)
//!
//! 这里是 Rust 侧唯一引用这些名字的地方:别处不许再手写 `name_id IS NULL` /
//! `name_id = 0`,`line_kind_tests.rs` 的普查守卫会扫描全仓并卡预算。
//! 动态 SQL 用这些常量拼(`format!`),静态 SQL 直接写视图名(它们已固定)。

/// 无名线:打标签 / `[[ ]]` 链接
pub const TAG_LINES: &str = "tag_lines";
/// 子级线:树的父子关系
pub const TREE_LINES: &str = "tree_lines";
/// 非结构线:引用 / 关系(含无名线与有名线)
pub const NON_TREE_LINES: &str = "non_tree_lines";

/// 从 `lines.name_id` 的取值反推该走哪条视图;`None` = 无名线。
///
/// 写路径用得上:建线时按这个决定要不要填名字点。读路径优先直接用视图,不必过它。
/// 有名线(`name_id` 指向名字点)返回 `relation_lines` —— 它的视图在迁移 033 里,
/// 这里只回名字,不再单列常量(写路径按名字点解析,不会硬编码它)。
pub fn view_for_name_id(name_id: Option<i64>) -> &'static str {
    match name_id {
        None => TAG_LINES,
        Some(0) => TREE_LINES,
        Some(_) => "relation_lines",
    }
}

#[cfg(test)]
#[path = "line_kind_tests.rs"]
mod line_kind_tests;
