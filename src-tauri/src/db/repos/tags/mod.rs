//! 标签家族仓库层门面(标签树 tree / 别名 alias / 关系 relation / 合并 merge / 写入收尾 write 收敛到一处)。
//!
//! 门面导出:子模块的公开项都经 `pub use ...::*` 上浮,调用方写短路径即可,例如
//! `crate::db::repos::tags::link_paths`、`tags::merge_tags`、`tags::set_tag_relation`、`tags::resolve`、`tags::finish`。
//! **撞名项:当前无** —— 子模块没有任何同名导出,故全部走 glob 门面。
//! tree 自身的内部子模块(ensure / path / replace / query / ops / ops_sql / order_support /
//! similar)仍挂在 tree 下:要按子模块显式指路时写 `crate::db::repos::tags::tree::<项>`
//! (例如测试用的 `tags::tree::counts`),这些子模块不单独上浮到 tags 命名空间。
pub mod alias;
pub mod auto_merge;
pub mod facts;
pub mod merge;
pub(crate) mod merge_children;
pub(crate) mod merge_edges;
pub mod relation;
pub mod tree;
pub(crate) mod fts_tags;
pub(crate) mod write;

/// Task 2 同父同名自动合并测试(设计 2026-10-06 §6)。
#[cfg(test)]
#[path = "auto_merge_tests.rs"]
mod auto_merge_tests;

/// Task 2 自动合并测试续(回滚 / md 差异 / 空操作 / 改名撞名)。
#[cfg(test)]
#[path = "auto_merge_extra_tests.rs"]
mod auto_merge_extra_tests;

/// 标签写入不变量测试台(E 组判据),随本模块收敛进 tags/。
#[cfg(test)]
#[path = "invariants_tests.rs"]
pub(crate) mod invariants_tests;

/// T4 守卫与行为读数:notes_fts.tags 列 = 路径聚合 + 纯文本路径聚合 + 别名聚合。
#[cfg(test)]
#[path = "fts_tags_tests.rs"]
mod fts_tags_tests;

/// T5 核心读数:祖先段带 md、笔记链叶子时的显示文本/旧名检索。
#[cfg(test)]
#[path = "fts_tag_plain_tests.rs"]
mod fts_tag_plain_tests;

pub use alias::*;
pub use facts::*;
pub use merge::*;
pub use relation::*;
pub use tree::*;
pub(crate) use write::*;
