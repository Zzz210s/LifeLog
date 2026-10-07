//! `notes_fts.tags` 列的聚合口径(唯一真源)。
//! 口径 = 该笔记**全部标签的完整路径** + 这些路径的**纯文本形态**(去掉行内 md)+
//! 这些标签上登记的**全部别名**;三段以单个空格相接,整体 `trim`,空段不产生双空格。
//!
//! 为什么多出"纯文本形态"(2026-09-26 tag-label-md T5):
//! 笔记链的是叶子 `地点/…/[郴](chēn)州市/宜章县`,带 md 的名字在**祖先段**上;
//! 只索引原始路径时,trigram 分词下用户会搜的**显示文本** `郴州市` 不在串里,
//! 3 字以上关键词静默搜不到。纯文本形态里就含 `郴州市`,祖先段的注解自然被覆盖。
//! 不含 md 的普通标签两点相同,故只用 `tag_plain(t.path) <> t.path` 挑出**真的有差异**的那些
//! —— 普通标签的索引串因此与 T4 逐字节一致(见用例③)。
//!
//! 别名口径保持 T4 的范围(**只**该笔记**直接链的标签**):把祖先标签的旧名也算进来会违反
//! 既有不变量「改名后旧路径不得残留」(`tree_time_ops_tests::time_root_can_be_renamed_and_fts_follows`
//! 明钉),故不扩到祖先链。
//!
//! 三处必须逐字一致,分叉就是"按显示文本搜不到、旧名仍命中"的静默漂移:
//!   ① 迁移 018 重建的六个触发器(副本由 [`tests`] 的守卫逐条比对)
//!   ② 结构变更后的显式重写 [`super::tree::refresh_fts`]
//!   ③ 不变量测试台 [`super::invariants_tests::assert_fts_matches_tags`]
//! （旧第③处"维护命令整体重建"已随 T4.4 切到 `entities_fts`/`ENTITIES_AGG`,不再消费本常量。）
//! 阶段定位（计划 T3.1/T3.2/T4.4）:`TAGS_AGG` 是阶段 3 前 `notes_fts` 的**活口径**;
//! T4.4 起 `notes_fts` 不再有生产读方,本常量只剩测试守卫与双写对照,
//! 故标 `#[cfg(test)]`;T4.7 删 `notes_fts` 时一并删除本文件。`entities_fts` 侧的真源见
//! [`crate::db::repos::entities::fts::ENTITIES_AGG`](两分支:笔记同本口径,标签取自身路径)。
//! 约束:表别名固定为 `n`(notes)——表达式只引用 `n.id`,调用方负责这么写别名。

/// 单条笔记的 tags 列聚合表达式(不含外层 `SELECT ... FROM notes n` 与 WHERE 部分)。
/// 每段用 `COALESCE(' ' || ..., '')` 拼:空段整段消失,不会留下多余空格(trim 只兜两端)。
#[cfg(test)]
pub(crate) const TAGS_AGG: &str = concat!(
    "trim(COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path) ",
    "FROM tags t JOIN tag_links l ON l.tag_id = t.id ",
    "WHERE l.target_type = 'note' AND l.target_id = n.id), '') || ",
    "COALESCE(' ' || (SELECT group_concat(tag_plain(t.path), ' ' ORDER BY t.path) ",
    "FROM tags t JOIN tag_links l ON l.tag_id = t.id ",
    "WHERE l.target_type = 'note' AND l.target_id = n.id ",
    "AND tag_plain(t.path) <> t.path), '') || ",
    "COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) ",
    "FROM tag_aliases a WHERE a.tag_id IN (SELECT l2.tag_id FROM tag_links l2 ",
    "WHERE l2.target_type = 'note' AND l2.target_id = n.id)), ''))"
);

/// 迁移 018 的 SQL 文本(仅守卫用例使用,不参与运行):
/// SQLite 无法在 .sql 与 Rust 之间共享字符串,靠比对把两份副本钉在一起。
#[cfg(test)]
pub(crate) const MIGRATION_018_SQL: &str =
    include_str!("../../migrations/018_fts_tag_plain_path.sql");
