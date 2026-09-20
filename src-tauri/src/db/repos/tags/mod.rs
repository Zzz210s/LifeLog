//! 标签家族仓库层门面(标签树 tree / 别名 alias / 合并 merge / 写入收尾 write 收敛到一处)。
//!
//! 门面导出:四个子模块的公开项都经 `pub use ...::*` 上浮,调用方写短路径即可,例如
//! `crate::db::repos::tags::link_paths`、`tags::merge_tags`、`tags::resolve`、`tags::finish`。
//! **撞名项:当前无** —— 四个子模块没有任何同名导出,故全部走 glob 门面。
//! tree 自身的内部子模块(ensure / path / replace / query / ops / ops_sql / order_support /
//! similar)仍挂在 tree 下:要按子模块显式指路时写 `crate::db::repos::tags::tree::<项>`
//! (例如测试用的 `tags::tree::counts`),这些子模块不单独上浮到 tags 命名空间。
pub mod alias;
pub mod merge;
pub mod tree;
pub(crate) mod write;

/// 标签写入不变量测试台(E 组判据),随本模块收敛进 tags/。
#[cfg(test)]
#[path = "invariants_tests.rs"]
pub(crate) mod invariants_tests;

pub use alias::*;
pub use merge::*;
pub use tree::*;
pub(crate) use write::*;
