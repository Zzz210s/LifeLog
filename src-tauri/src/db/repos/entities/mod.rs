//! 统一实体(`entities` / `edges`)的仓库层:缓存对账、`ENTITIES_AGG` 聚合、id 分配。
//! 阶段 4 起不再有标签 id 偏移常量(统一元数据后全库连号,见 `ids::next_entity_id`)。

pub mod closure;
pub mod fts;
pub mod ids;
pub mod reconcile;
pub mod reconcile_checks;
/// T1.4 保留名字点 `子级` 的体检 / 自愈 / 恢复(spec §6.2)。
pub mod reserved;

#[cfg(test)]
mod reconcile_tests;

#[cfg(test)]
#[path = "reserved_tests.rs"]
mod reserved_tests;

/// 阶段 4 收口守卫:旧偏移标识符不再出现在任何源码里。
#[cfg(test)]
#[path = "no_legacy_offset_tests.rs"]
mod no_legacy_offset_tests;

/// T3.1 `ENTITIES_AGG` 行为读数。
#[cfg(test)]
#[path = "fts_tests.rs"]
mod fts_tests;

/// T1.4 祖先闭包与 `is_cited` 增量维护。
#[cfg(test)]
#[path = "closure_tests.rs"]
mod closure_tests;
