//! `notes_fts.tags` 列的聚合口径(唯一真源)。
//! 口径 = 该笔记**全部标签的完整路径** + 这些标签的**全部别名**(各自 `ORDER BY` 后
//! 以空格相接,整体 `trim`)。
//! 为什么含别名(2026-09-26 tag-label-md T4):标签名支持行内 md 后,路径里是 md 源码
//! (`[郴](chēn)州市`),trigram 分词下用户会搜的**显示文本**(`郴州市`)不在索引串里,
//! 3 字以上关键词静默搜不到。T2 已把 md 名字的纯文本形态登记为别名,纳入即通;
//! 连带好处:改名/合并后搜旧名照样命中那篇笔记。
//! 四处必须逐字一致,分叉就是"按显示文本搜不到、旧名仍命中"的静默漂移:
//!   ① 迁移 017 重建的六个触发器(副本由 [`tests`] 的守卫逐条比对)
//!   ② 结构变更后的显式重写 [`super::tree::refresh_fts`]
//!   ③ 维护命令的整体重建 `commands::maintenance::rebuild`
//!   ④ 不变量测试台 [`super::invariants_tests::assert_fts_matches_tags`]
//! 约束:表别名固定为 `n`(notes)——表达式只引用 `n.id`,调用方负责这么写别名。

/// 单条笔记的 tags 列聚合表达式(不含外层 `SELECT ... FROM notes n` 与 WHERE 部分)
pub(crate) const TAGS_AGG: &str = concat!(
    "trim(COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path) ",
    "FROM tags t JOIN tag_links l ON l.tag_id = t.id ",
    "WHERE l.target_type = 'note' AND l.target_id = n.id), '') || ' ' || ",
    "COALESCE((SELECT group_concat(a.alias, ' ' ORDER BY a.alias) ",
    "FROM tag_aliases a WHERE a.tag_id IN (SELECT l2.tag_id FROM tag_links l2 ",
    "WHERE l2.target_type = 'note' AND l2.target_id = n.id)), ''))"
);

/// 迁移 017 的 SQL 文本(仅守卫用例使用,不参与运行):
/// SQLite 无法在 .sql 与 Rust 之间共享字符串,靠比对把两份副本钉在一起。
#[cfg(test)]
pub(crate) const MIGRATION_017_SQL: &str =
    include_str!("../../migrations/017_fts_tag_aliases.sql");
