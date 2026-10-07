//! `entities_fts.tag_paths` 列的聚合口径(唯一真源,spec §4.2 / 计划 T3.1)。
//!
//! 笔记实体 = 它 `tagging` 边指向标签的完整路径 + 这些路径的纯文本形态(去行内 md) +
//! 这些标签的全部别名(= 旧 `tags::fts_tags::TAGS_AGG` 的三段,表名换到 `entities`/`edges`);
//! 三段以单空格相接,整体 `trim`,空段不产生双空格。标签实体 = 自身完整路径 `e.path` +
//! 自己的纯文本形态(仅当与 `path` 不同) + 自身全部别名。
//! 笔记段多出"纯文本形态"的原因(2026-09-26 tag-label-md T5):笔记链的是叶子标签,
//! 带 md 的名字在祖先段上,只索引原始路径时 trigram 搜不到界面上看到的显示文本。
//! 别名口径保持"只该笔记直接链的标签":把祖先旧名也算进来会违反既有不变量
//! 「改名后旧路径不得残留」(`tree_time_ops_tests::time_root_can_be_renamed_and_fts_follows`)。
//!
//! 两分支由 `CASE WHEN e.kind = 'note'` 合成一个常量,别名固定为 `e`(entities):
//! 表达式只引用 `e.id` / `e.kind` / `e.path`,调用方负责这么写别名。
//!
//! 收口范围:本常量是 `entities_fts` 侧唯一真源 —— 结构变更后的显式重写
//! [`crate::db::repos::tags::tree::refresh_entities_fts`]、不变量测试台
//! [`crate::db::repos::tags::invariants_tests::assert_fts_matches_edges`] 已引用它。
//! 迁移 026 的九个触发器与整体重建 SQL 由 T3.2 写成同一段(那段 `include_str!` 的
//! `MIGRATION_026_SQL` 守卫随 026 一起落,本任务不建 026 文件);维护命令的 `entities_fts`
//! 重建在阶段 4 随 `notes_fts` 下架时接入。旧 `TAGS_AGG`(notes_fts 口径)在阶段 4 前保持
//! 不变,避免应用读错表 —— 两者的逐字节等价由 `fts_tests` 与真库 sha256 用例钉住。
pub(crate) const ENTITIES_AGG: &str = concat!(
    "trim(CASE WHEN e.kind = 'note' THEN ",
    // 笔记分支:tagging 边指向标签的路径
    "COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path) ",
    "FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id ",
    "WHERE l.source_id = e.id), '') || ",
    // 笔记分支:这些路径的纯文本形态(仅挑真有差异的)
    "COALESCE(' ' || (SELECT group_concat(tag_plain(t.path), ' ' ORDER BY t.path) ",
    "FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id ",
    "WHERE l.source_id = e.id AND tag_plain(t.path) <> t.path), '') || ",
    // 笔记分支:这些标签的别名
    "COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) ",
    "FROM entity_aliases a WHERE a.entity_id IN (SELECT l2.target_id FROM edges l2 ",
    "WHERE l2.kind = 'tagging' AND l2.source_id = e.id)), '') ",
    // 标签分支:自身完整路径 + 纯文本形态(仅当不同) + 自身别名
    "ELSE COALESCE(e.path, '') || ",
    "COALESCE(' ' || (SELECT tag_plain(e.path) WHERE tag_plain(e.path) <> e.path), '') || ",
    "COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) ",
    "FROM entity_aliases a WHERE a.entity_id = e.id), '') END)"
);

/// 迁移 026 的原始文本(`include_str!`):守卫用例
/// `entities_fts_migration_tests::agg_segments_appear_in_026_text` 按 `COALESCE(` 切段,
/// 逐段比对它包含同一份 [`ENTITIES_AGG`]。SQLite 无法在 `.sql` 与 Rust 间共享字符串字面量,
/// `include_str!` + 守卫是既有约定(见 018 的同类守卫)。
pub(crate) const MIGRATION_026_SQL: &str = include_str!("../../migrations/026_entities_fts.sql");
