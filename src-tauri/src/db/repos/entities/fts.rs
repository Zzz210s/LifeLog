//! `entities_fts.paths` 列的聚合口径(唯一真源,spec §6.2)。
//!
//! 统一实体后同一份表达式对每个实体统一求值(不再 `CASE WHEN e.kind`),两段相接:
//!   ① 自身段:`e.path`(标签是完整路径、笔记为空)+ 它的纯文本形态(仅当与 `path` 不同)+
//!      自身全部别名;
//!   ② 引用段:出 `link` 边目标的 `path` 串 + 这些路径的纯文本形态(仅挑真有差异的)+ 目标别名。
//!
//! 笔记实体:出 `link` 边即老 `tagging` 边(真库无笔记间 `link`),自身段为空 -> 目标段与旧
//! 「`kind='note'` 分支」逐字节相同(计划 T1.3 用例 ①)。标签实体:自身段与旧「`kind='tag'` 分支」
//! 相同,引用段是新增量(真库 = 老 `relation` 的 24 条),用例 ② 逐条列出。
//! 三段以单空格相接,整体 `trim`,空段不产生双空格。别名口径仍是「直接链接的标签」:把祖先旧名
//! 也算进来会违反既有不变量「改名后旧路径不得残留」(`tree_time_ops_tests` 用例)。
//!
//! 聚合表达式**全局只此一份文本**:迁移 029 的视图 `entities_fts_src` 由 [`crate::db::migration_hooks`]
//! 的 v29 前置钩子用本常量拼接 `CREATE VIEW` 建出(029.sql 里不出现任何聚合文本,由守卫
//! `entities_fts_migration_tests::migration_029_has_no_aggregate_sql` 钉住);9 个触发器、显式重写
//! [`crate::db::repos::tags::tree::refresh_entities_fts`]、维护命令 `maintenance::rebuild` 与不变量测试台
//! [`crate::db::repos::tags::invariants_tests::assert_fts_matches_edges`] 都从该视图/常量取值。
//!
//! 表达式只引用别名 `e`(`entities`)与 `entity_aliases` / `edges`,调用方负责这么写别名。
pub(crate) const ENTITIES_AGG: &str = concat!(
    "trim(",
    // 自身段:完整路径(笔记为 NULL -> 空串)
    "COALESCE(e.path, '') || ",
    // 自身段:纯文本形态(仅当与 path 真有差异;`COALESCE` 盖住笔记的 NULL path)
    "COALESCE(' ' || (SELECT tag_plain(COALESCE(e.path, '')) ",
    "WHERE tag_plain(COALESCE(e.path, '')) <> e.path), '') || ",
    // 自身段:自身全部别名
    "COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) ",
    "FROM entity_aliases a WHERE a.entity_id = e.id), '') || ",
    // 引用段:出 link 边目标的完整路径
    "COALESCE(' ' || (SELECT group_concat(t.path, ' ' ORDER BY t.path) ",
    "FROM entities t JOIN edges l ON l.kind = 'link' AND l.target_id = t.id ",
    "WHERE l.source_id = e.id), '') || ",
    // 引用段:目标路径的纯文本形态(仅挑真有差异的;目标可能是笔记,path 为 NULL)
    "COALESCE(' ' || (SELECT group_concat(tag_plain(COALESCE(t.path, '')), ' ' ORDER BY t.path) ",
    "FROM entities t JOIN edges l ON l.kind = 'link' AND l.target_id = t.id ",
    "WHERE l.source_id = e.id AND tag_plain(COALESCE(t.path, '')) <> t.path), '') || ",
    // 引用段:目标的全部别名
    "COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) ",
    "FROM entity_aliases a WHERE a.entity_id IN (SELECT l2.target_id FROM edges l2 ",
    "WHERE l2.kind = 'link' AND l2.source_id = e.id)), '')",
    ")"
);

/// 迁移 029 的原始文本(`include_str!`):守卫用例
/// `entities_fts_migration_tests::migration_029_has_no_aggregate_sql` 断言它**不含**任何聚合段
/// (聚合文本由 v29 前置钩子拼视图写入;SQLite 无法在 `.sql` 与 Rust 间共享字符串字面量,
/// `include_str!` + 守卫是既有约定,见 018 / 026 的同类守卫)。
pub(crate) const MIGRATION_029_SQL: &str =
    include_str!("../../migrations/029_entities_fts.sql");
