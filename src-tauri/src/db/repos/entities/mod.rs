//! 统一实体(`entities` / `edges`)的仓库层。阶段 1 只放标签 id 偏移常量与缓存对账,
//! 后续任务按需追加子模块(`fts` 由 T3.1)——先声明后建文件会让迁移 024 落地的瞬间编译不过。

pub mod fts;
pub mod ids;
pub mod reconcile;
pub mod reconcile_checks;

#[cfg(test)]
mod reconcile_tests;

/// T3.1 `ENTITIES_AGG` 行为读数。
#[cfg(test)]
#[path = "fts_tests.rs"]
mod fts_tests;

/// 标签实体 id 相对老 `tags.id` 的整体偏移(spec §12 D1)。
/// 真库 `max(tags.id)=845`、`max(notes.id)=1399`,偏移后两个区间永久不撞。
/// `migrations/024_entities_tags.sql` 里的字面量由守卫用例 `offset_literal_matches_const` 比对,
/// 改这里必须同时改迁移 SQL。
pub const TAG_ID_OFFSET: i64 = 1_000_000_000;
