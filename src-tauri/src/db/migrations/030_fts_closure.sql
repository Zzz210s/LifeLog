-- 030: 统一实体 FTS 闭包收口(计划「读侧收口之一」)—— 视图重建 + 闭包刷新触发器 + 全库回填。
--
-- ① 聚合口径真源仍是 Rust 常量
--    [`crate::db::repos::entities::fts::ENTITIES_AGG`]。030 给每个实体新增两段:
--    「出边目标 T 的子孙」与「T 及其祖先链上出 link 的 B 及其子孙」。
--    视图 `entities_fts_src` 由 v29/v30 的事务内前置钩子
--    (`migration_hooks::create_entities_fts_src_view`)用该常量重建;**本文件不写聚合文本**,
--    守卫用例 `entities_fts_migration_tests::migration_030_has_no_aggregate_sql` 钉住。
--
-- ② 029 的 9 个触发器按旧口径只刷「边两端 / 子树 + 子树引用源」。新闭包让 FTS 还依赖
--    出边目标的祖先链来源(DESC)与关系源子树来源(REL),故追加以下闭包触发器(不改 029 的):
--    对节点 seed,刷新集合 = subtree(seed)
--      ∪ linkSources(ancestorsOrSelf(seed) ∪ subtree({a : a --link--> B, B ∈ ancestorsOrSelf(seed)}))
--    边/别名的 old、new 两侧都刷。
--    必须用 `DELETE` + 普通 `INSERT`(不能用 `INSERT OR REPLACE`):外层若为 `INSERT OR IGNORE`
--    (生产多处如此),FTS5 的 REPLACE 会被继承的冲突策略静默吞掉(实测),DELETE 无此问题。
--
-- ③ 全库回填。视图与触发器都引用标量函数 `tag_plain`,由 `migrate::apply` 预先注册;
--    SQL 与 user_version 在同一事务,幂等(DROP IF EXISTS + 清表回填)。

-- ============ 0. 幂等:清掉本迁移新增的闭包触发器 ============
DROP TRIGGER IF EXISTS edges_fts_closure_ai;
DROP TRIGGER IF EXISTS edges_fts_closure_ad;
DROP TRIGGER IF EXISTS edges_fts_closure_au;
DROP TRIGGER IF EXISTS entities_fts_closure_au;
DROP TRIGGER IF EXISTS entity_aliases_fts_closure_ai;
DROP TRIGGER IF EXISTS entity_aliases_fts_closure_au;
DROP TRIGGER IF EXISTS entity_aliases_fts_closure_ad;

-- ============ 2. 全库回填(与维护命令同一视图真源、同一事务;幂等)============
DELETE FROM entities_fts;
INSERT INTO entities_fts(rowid, meta, paths)
SELECT id, meta, paths FROM entities_fts_src;
