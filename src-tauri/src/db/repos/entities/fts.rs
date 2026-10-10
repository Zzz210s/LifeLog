//! `entities_fts.paths` 列的聚合口径(唯一真源,spec §6.2)。
//!
//! 统一实体后同一份表达式对每个实体统一求值(不再 `CASE WHEN e.kind`),两段相接:
//!   ① 自身段:`e.path`(标签是完整路径、笔记为空)+ 它的纯文本形态(仅当与 `path` 不同)+
//!      自身全部别名;
//!   ② 引用段:出 `link` 边目标的 `path` 串 + 这些路径的纯文本形态(仅挑真有差异的)+ 目标别名;
//!   ③ 子孙闭包段:出边目标 `T` 的子孙路径(沿 `parent_id` 递归,不含 `T` 自己);
//!   ④ 关系闭包段:`T` **及其祖先链**上每个树内实体出 `link` 边指向的 `B` 的 path·纯文本·别名,
//!      以及 `B` 的子孙路径(不含已经直链的 `T`)。
//!
//! ③④ 是 030 的增量(计划「读侧收口之一」):删掉「笔记 -> 地点轴/所在」这类冗余直链后,
//! 搜 `地点轴/所在`(经 `旅游/餐厅 --(所在)--> 地点轴/所在` 关系)与搜 `旅游/餐厅` 的子孙仍能命中。
//! 关系闭包必须沿**祖先链**走(`T` 挂在一个祖先上同样携带该祖先的关系),这正是筛选侧
//! `carry_predicate` 的口径(命中集 = 关系源 `ca` 本身 ∪ `ca` 的后代),否则搜索与筛选会再次分叉。
//!
//! 闭包仍是一次性、最多一跳的展开(不递归关系链):`T` 的祖先只取其出边目标,不再继续上溯;
//! 目标 `B` 只取其子孙,不再取 `B` 出边。
//!
//! 笔记实体:出 `link` 边即老 `tagging` 边(真库无笔记间 `link`),自身段为空 -> 目标段与旧
//! 「`kind='note'` 分支」逐字节相同(计划 T1.3 用例 ①)。标签实体:自身段与旧「`kind='tag'` 分支」
//! 相同,引用段是新增量(真库 = 老 `relation` 的 24 条),用例 ② 逐条列出。
//! 夹具里若没有 `parent_id` / 关系链,③④ 两段取空,旧读数逐字节不变(`fts_tests`)。
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
    "WHERE l2.kind = 'link' AND l2.source_id = e.id)), '') || ",
    // ③ 子孙闭包段:出边目标 T 的子孙(不含 T 自己,已由引用段覆盖)
    "COALESCE(' ' || (WITH RECURSIVE ",
    "t0(id) AS (SELECT t.id FROM entities t JOIN edges l ON l.kind = 'link' AND l.target_id = t.id ",
    "WHERE l.source_id = e.id), ",
    "sub(id) AS (SELECT id FROM t0 UNION SELECT c.id FROM entities c JOIN sub s ON c.parent_id = s.id), ",
    "extra(id) AS (SELECT id FROM sub WHERE id NOT IN (SELECT id FROM t0)) ",
    "SELECT group_concat(x, ' ') FROM (SELECT DISTINCT x FROM ( ",
    "SELECT d.path AS x FROM extra ex JOIN entities d ON d.id = ex.id WHERE d.path IS NOT NULL ",
    "UNION SELECT tag_plain(d.path) FROM extra ex JOIN entities d ON d.id = ex.id ",
    "WHERE d.path IS NOT NULL AND tag_plain(d.path) <> d.path ",
    "UNION SELECT a.alias FROM entity_aliases a WHERE a.entity_id IN (SELECT id FROM extra)))), '') || ",
    // ④ 关系闭包段:T 的祖先链(含 T)出 link 的目标 B,及 B 的子孙(不含已直链的 T)
    "COALESCE(' ' || (WITH RECURSIVE ",
    "t0(id) AS (SELECT t.id FROM entities t JOIN edges l ON l.kind = 'link' AND l.target_id = t.id ",
    "WHERE l.source_id = e.id), ",
    "chain(id) AS (SELECT id FROM t0 UNION SELECT ce.parent_id FROM chain ch ",
    "JOIN entities ce ON ce.id = ch.id WHERE ce.parent_id IS NOT NULL), ",
    "b0(id) AS (SELECT lb.target_id FROM chain ch JOIN edges lb ",
    "ON lb.kind = 'link' AND lb.source_id = ch.id WHERE lb.target_id NOT IN (SELECT id FROM t0)), ",
    "bsub(id) AS (SELECT id FROM b0 UNION SELECT c.id FROM entities c JOIN bsub s ON c.parent_id = s.id) ",
    "SELECT group_concat(x, ' ') FROM (SELECT DISTINCT x FROM ( ",
    "SELECT d.path AS x FROM bsub ex JOIN entities d ON d.id = ex.id WHERE d.path IS NOT NULL ",
    "UNION SELECT tag_plain(d.path) FROM bsub ex JOIN entities d ON d.id = ex.id ",
    "WHERE d.path IS NOT NULL AND tag_plain(d.path) <> d.path ",
    "UNION SELECT a.alias FROM entity_aliases a WHERE a.entity_id IN (SELECT id FROM bsub)))), '')",
    ")"
);

/// 迁移 029 的原始文本(`include_str!`):守卫用例
/// `entities_fts_migration_tests::migration_029_has_no_aggregate_sql` 断言它**不含**任何聚合段
/// (聚合文本由 v29 前置钩子拼视图写入;SQLite 无法在 `.sql` 与 Rust 间共享字符串字面量,
/// `include_str!` + 守卫是既有约定,见 018 / 026 的同类守卫)。
pub(crate) const MIGRATION_029_SQL: &str =
    include_str!("../../migrations/029_entities_fts.sql");

/// 迁移 030 的原始文本(`include_str!`):守卫用例
/// `entities_fts_migration_tests::migration_030_has_no_aggregate_sql` 断言它**不含**任何聚合段
/// (视图仍由 v29/v30 前置钩子从 [`ENTITIES_AGG`] 拼出;030 只做全库回填)。
pub(crate) const MIGRATION_030_SQL: &str =
    include_str!("../../migrations/030_fts_closure.sql");

// ===================== v31 点 / 线(spec §7)=====================

/// `points_fts.paths` 列的聚合口径(v31 点/线,spec §7.1)。与 [`ENTITIES_AGG`] 四段一一对应,
/// 只把 v30 的「出 `link` 边」换成 v31 的「出非子级线」(`name_id IS NULL OR name_id <> 0`,
/// 即 spec 的两条替换规则之一 `R(kind='link')`),表名 `entities`→`points`、`edges`→`lines`、
/// `source_id`→`from_id`、`target_id`→`to_id`;子孙 / 祖先递归仍沿 `parent_id`(`sub` / `chain` /
/// `bsub`),形状与 v30 逐字相同。
///
/// **本常量是 v31 聚合文本的唯一真源**:视图 `points_fts_src` 由 v31 事务内前置钩子
/// [`crate::db::migration_hooks::create_points_fts_src_view`] 用它拼出,迁移 `.sql` 里不出现任何
/// 聚合段(守卫用例 `point_line_fts_tests::migration_031_has_no_aggregate_sql`)。
///
/// [`ENTITIES_AGG`] 仍是 v29 / v30 迁移步骤的历史口径(旧库升级链 `v29 → v30 → v31` 要先建老视图),
/// 两者各管一个 schema 版本,不是同一版本的重复文本。
pub(crate) const POINTS_AGG: &str = concat!(
    "trim(",
    // 自身段:完整路径(笔记为 NULL -> 空串)
    "COALESCE(e.path, '') || ",
    // 自身段:纯文本形态(仅当与 path 真有差异)
    "COALESCE(' ' || (SELECT tag_plain(COALESCE(e.path, '')) ",
    "WHERE tag_plain(COALESCE(e.path, '')) <> e.path), '') || ",
    // 自身段:自身全部别名
    "COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) ",
    "FROM entity_aliases a WHERE a.entity_id = e.id), '') || ",
    // 引用段:出非子级线目标的完整路径
    "COALESCE(' ' || (SELECT group_concat(t.path, ' ' ORDER BY t.path) ",
    "FROM points t JOIN lines l ON (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id = t.id ",
    "WHERE l.from_id = e.id), '') || ",
    // 引用段:目标路径的纯文本形态(仅挑真有差异的)
    "COALESCE(' ' || (SELECT group_concat(tag_plain(COALESCE(t.path, '')), ' ' ORDER BY t.path) ",
    "FROM points t JOIN lines l ON (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id = t.id ",
    "WHERE l.from_id = e.id AND tag_plain(COALESCE(t.path, '')) <> t.path), '') || ",
    // 引用段:目标的全部别名
    "COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) ",
    "FROM entity_aliases a WHERE a.entity_id IN (SELECT l2.to_id FROM lines l2 ",
    "WHERE (l2.name_id IS NULL OR l2.name_id <> 0) AND l2.from_id = e.id)), '') || ",
    // ③ 子孙闭包段:非子级线目标 T 的子孙(不含 T 自己,已由引用段覆盖)
    "COALESCE(' ' || (WITH RECURSIVE ",
    "t0(id) AS (SELECT t.id FROM points t JOIN lines l ",
    "ON (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id = t.id WHERE l.from_id = e.id), ",
    "sub(id) AS (SELECT id FROM t0 UNION SELECT c.id FROM points c JOIN sub s ON c.parent_id = s.id), ",
    "extra(id) AS (SELECT id FROM sub WHERE id NOT IN (SELECT id FROM t0)) ",
    "SELECT group_concat(x, ' ') FROM (SELECT DISTINCT x FROM ( ",
    "SELECT d.path AS x FROM extra ex JOIN points d ON d.id = ex.id WHERE d.path IS NOT NULL ",
    "UNION SELECT tag_plain(d.path) FROM extra ex JOIN points d ON d.id = ex.id ",
    "WHERE d.path IS NOT NULL AND tag_plain(d.path) <> d.path ",
    "UNION SELECT a.alias FROM entity_aliases a WHERE a.entity_id IN (SELECT id FROM extra)))), '') || ",
    // ④ 关系闭包段:T 的祖先链(含 T)出非子级线的目标 B,及 B 的子孙(不含已直链的 T)
    "COALESCE(' ' || (WITH RECURSIVE ",
    "t0(id) AS (SELECT t.id FROM points t JOIN lines l ",
    "ON (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id = t.id WHERE l.from_id = e.id), ",
    "chain(id) AS (SELECT id FROM t0 UNION SELECT ce.parent_id FROM chain ch ",
    "JOIN points ce ON ce.id = ch.id WHERE ce.parent_id IS NOT NULL), ",
    "b0(id) AS (SELECT lb.to_id FROM chain ch JOIN lines lb ",
    "ON (lb.name_id IS NULL OR lb.name_id <> 0) AND lb.from_id = ch.id ",
    "WHERE lb.to_id NOT IN (SELECT id FROM t0)), ",
    "bsub(id) AS (SELECT id FROM b0 UNION SELECT c.id FROM points c JOIN bsub s ON c.parent_id = s.id) ",
    "SELECT group_concat(x, ' ') FROM (SELECT DISTINCT x FROM ( ",
    "SELECT d.path AS x FROM bsub ex JOIN points d ON d.id = ex.id WHERE d.path IS NOT NULL ",
    "UNION SELECT tag_plain(d.path) FROM bsub ex JOIN points d ON d.id = ex.id ",
    "WHERE d.path IS NOT NULL AND tag_plain(d.path) <> d.path ",
    "UNION SELECT a.alias FROM entity_aliases a WHERE a.entity_id IN (SELECT id FROM bsub)))), '')",
    ")"
);

/// 纯名字点的位置判据(v31,spec §5.4-⑧ / §7.1):出现在某条线的 `name_id` 位、
/// 且不出现在任何线两端。这类点整行不进 FTS;别名 `e` = `points`。
/// 视图 `points_fts_src` 的 `WHERE` 复用本段文本(守卫用例逐段比对)。
pub(crate) const NOT_PURE_NAME: &str = concat!(
    "NOT (EXISTS(SELECT 1 FROM lines n WHERE n.name_id = e.id) ",
    "AND NOT EXISTS(SELECT 1 FROM lines t WHERE t.from_id = e.id OR t.to_id = e.id))"
);

/// v31 的显式重写(spec §7.2):结构变更后按受影响点 id 重写 FTS 行。
/// 直接读视图 `points_fts_src`,纯名字点天然无行(DELETE 后 INSERT ... SELECT 为空 = no-op)。
/// 生产写路径在阶段 2 接入(T2.2);本任务先给出与触发器同源的入口。
#[allow(dead_code)]
pub(crate) fn refresh_points_fts(
    conn: &rusqlite::Connection,
    point_ids: &[i64],
) -> rusqlite::Result<()> {
    for id in point_ids {
        conn.execute("DELETE FROM points_fts WHERE rowid = ?1", rusqlite::params![id])?;
        conn.execute(
            "INSERT INTO points_fts(rowid, meta, paths)
             SELECT id, meta, paths FROM points_fts_src WHERE id = ?1",
            rusqlite::params![id],
        )?;
    }
    Ok(())
}

/// 迁移 031(点/线重建)与它的两个 FTS 文件的原始文本(`include_str!`):守卫用例
/// `point_line_fts_tests::migration_031_has_no_aggregate_sql` 断言它们**不含**聚合段
/// (聚合文本由 v31 前置钩子从 [`POINTS_AGG`] 拼视图写入)。
pub(crate) const MIGRATION_031_SQL: &str =
    include_str!("../../migrations/031_point_line.sql");
pub(crate) const MIGRATION_031_FTS_SQL: &str =
    include_str!("../../migrations/031_point_line_fts.sql");
pub(crate) const MIGRATION_031_FTS_CLOSURE_SQL: &str =
    include_str!("../../migrations/031_point_line_fts_closure.sql");
