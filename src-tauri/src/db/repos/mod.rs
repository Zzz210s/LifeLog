pub mod notes;
pub mod settings;
pub mod tabs_rewrite;
pub mod tag_alias;
pub mod tags_tree;
pub mod tags_tree_merge;
pub(crate) mod tags_write;

#[cfg(test)]
#[path = "tags_invariants_tests.rs"]
pub(crate) mod tags_invariants_tests;
