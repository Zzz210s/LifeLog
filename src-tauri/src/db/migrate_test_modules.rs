//! `migrate.rs` 的测试模块集中注册处:注册块与迁移逻辑分离,守 200 行红线。
//! `use super::*;` 把 `migrate` 的私有项(apply / run / MIGRATIONS 等)挂进本模块命名空间,
//! 子测试模块原来的 `use super::*;` 经此透传,语义与它们直接挂在 `migrate` 下一致。
#![allow(unused_imports)]
use super::*;

#[cfg(test)]
#[path = "rename_keys_tests.rs"]
mod rename_keys_tests;

#[cfg(test)]
#[path = "tag_tree_migration_tests.rs"]
mod tag_tree_migration_tests;

#[cfg(test)]
#[path = "views_migration_tests.rs"]
mod views_migration_tests;

#[cfg(test)]
#[path = "saved_views_removal_tests.rs"]
mod saved_views_removal_tests;

#[cfg(test)]
#[path = "migration_atomicity_tests.rs"]
mod migration_atomicity_tests;

#[cfg(test)]
#[path = "time_tag_migration_tests.rs"]
mod time_tag_migration_tests;

#[cfg(test)]
#[path = "drop_updated_at_tests.rs"]
mod drop_updated_at_tests;

#[cfg(test)]
#[path = "migrate_tests.rs"]
mod migrate_tests;

#[cfg(test)]
#[path = "backfill_hook_tests.rs"]
mod backfill_hook_tests;

#[cfg(test)]
#[path = "filter_current_migration_tests.rs"]
mod filter_current_migration_tests;

#[cfg(test)]
#[path = "time_tag_demotion_tests.rs"]
mod time_tag_demotion_tests;

#[cfg(test)]
#[path = "done_doing_migration_tests.rs"]
mod done_doing_migration_tests;

#[cfg(test)]
#[path = "done_doing_fts_tests.rs"]
mod done_doing_fts_tests;

#[cfg(test)]
#[path = "fts_tag_plain_migration_tests.rs"]
mod fts_tag_plain_migration_tests;

#[cfg(test)]
#[path = "tag_types_migration_tests.rs"]
mod tag_types_migration_tests;

#[cfg(test)]
#[path = "tag_relations_migration_tests.rs"]
mod tag_relations_migration_tests;

#[cfg(test)]
#[path = "tag_link_remark_migration_tests.rs"]
mod tag_link_remark_migration_tests;

#[cfg(test)]
#[path = "entities_tags_fixture.rs"]
mod entities_tags_fixture;

#[cfg(test)]
#[path = "entities_phase2_fixture.rs"]
mod entities_phase2_fixture;

#[cfg(test)]
#[path = "entities_tags_migration_tests.rs"]
mod entities_tags_migration_tests;

#[cfg(test)]
#[path = "entities_tags_edges_tests.rs"]
mod entities_tags_edges_tests;

#[cfg(test)]
#[path = "entities_phase1_tests.rs"]
mod entities_phase1_tests;

#[cfg(test)]
#[path = "entities_notes_migration_tests.rs"]
mod entities_notes_migration_tests;

#[cfg(test)]
#[path = "entities_phase2_tests.rs"]
mod entities_phase2_tests;

#[cfg(test)]
#[path = "entities_phase2_counts_tests.rs"]
mod entities_phase2_counts_tests;

#[cfg(test)]
#[path = "entities_fts_migration_tests.rs"]
mod entities_fts_migration_tests;

#[cfg(test)]
#[path = "drop_legacy_migration_tests.rs"]
mod drop_legacy_migration_tests;

#[cfg(test)]
#[path = "entity_ids_hook_tests.rs"]
mod entity_ids_hook_tests;

#[cfg(test)]
#[path = "unify_meta_hook_tests.rs"]
mod unify_meta_hook_tests;

#[cfg(test)]
#[path = "unify_meta_migration_tests.rs"]
mod unify_meta_migration_tests;

#[cfg(test)]
#[path = "unify_meta_upgrade_tests.rs"]
mod unify_meta_upgrade_tests;
