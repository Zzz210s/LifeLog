-- LifeLog 统一元数据迁移 · 对账唯一真源（spec docs/superpowers/specs/2026-10-08-unify-metadata-design.md §3.7 七条 + §2.7 稳定读数）
--
-- 执行方：
--   * scripts/entity-migration/reconcile.mjs（python sqlite3，mode=ro；运行器内置 entity_name / entity_key 同口径实现）
--   * Rust src-tauri/src/db/repos/entities/reconcile.rs（include_str! 同一文件；entity_name / entity_key 由连接注册，见 db/sql_functions.rs）
-- 标记块：语句块以一个标记行开头，到下一个标记行或文件末尾结束；块内只放一条 SQL 语句。
--   -- @count | <键> | <需要的表或列>                 计数读数（只打印，不判 PASS/FAIL）
--   -- @check | <序号> | <标题> | <模式> | <需要的表或列> | <期望>   对账；期望 = zero（0 行通过）或 ok（单行 'ok' 通过）
-- 「需要的表或列」为逗号分隔：table 或 table.column；任一表/列不存在则整块打印 N/A。
-- 七条（①–⑦）统一要求 v28 结构（entities.meta / entities.is_cited）；旧库（< 28）整组 N/A，不报错。
-- ⑦ 的连号只在「无合并记录」的库上要求：产品自动合并与引用优化 A3 都会删实体，断号是常态。
-- 真库只读：本文件只允许 SELECT / 只读 PRAGMA，禁止任何写语句。

-- ============ 计数读数（v27 可跑的只有 entities / edges / path 三类）============
-- @count | user_version | 
PRAGMA user_version;
-- @count | entities | entities
SELECT COUNT(*) FROM entities;
-- @count | entities_min_id | entities
SELECT MIN(id) FROM entities;
-- @count | entities_max_id | entities
SELECT MAX(id) FROM entities;
-- @count | entities_distinct_id | entities
SELECT COUNT(DISTINCT id) FROM entities;
-- @count | id_gaps | entities
SELECT COUNT(*) FROM (SELECT id, LAG(id) OVER (ORDER BY id) AS prev FROM entities)
WHERE prev IS NOT NULL AND id <> prev + 1;
-- @count | id_merge_log | entity_merge_log
SELECT COUNT(*) FROM entity_merge_log;
-- @count | entities_path_nonnull | entities.path
SELECT COUNT(*) FROM entities WHERE path IS NOT NULL;
-- @count | entities_path_null | entities.path
SELECT COUNT(*) FROM entities WHERE path IS NULL;
-- @count | edges | edges
SELECT COUNT(*) FROM edges;
-- @count | entities_fts | entities_fts
SELECT COUNT(*) FROM entities_fts;

-- ============ 计数读数（仅 v28 结构可跑）============
-- @count | is_cited | entities.is_cited
SELECT COUNT(*) FROM entities WHERE is_cited = 1;
-- @count | edges_child | entities.is_cited
SELECT COUNT(*) FROM edges WHERE kind = 'child';
-- @count | edges_link | entities.is_cited
SELECT COUNT(*) FROM edges WHERE kind = 'link';
-- @count | link_remark_nonnull | entities.is_cited
SELECT COUNT(*) FROM edges WHERE kind = 'link' AND remark <> '';
-- @count | tree_closure | entities.is_cited
WITH RECURSIVE c(id) AS (
  SELECT id FROM entities WHERE is_cited = 1
  UNION
  SELECT x.source_id FROM edges x JOIN c ON c.id = x.target_id WHERE x.kind = 'child'
)
SELECT COUNT(*) FROM c;
-- @count | feed_default | entities.is_cited
WITH RECURSIVE c(id) AS (
  SELECT id FROM entities WHERE is_cited = 1
  UNION
  SELECT x.source_id FROM edges x JOIN c ON c.id = x.target_id WHERE x.kind = 'child'
)
SELECT COUNT(*) FROM entities e
WHERE NOT (e.id IN (SELECT id FROM c) AND instr(e.meta, char(10)) = 0);
-- @count | sibling_key_out_of_scope | entities.is_cited
SELECT COUNT(*) FROM (
  SELECT COALESCE(e.parent_id, 0), entity_key(e.meta)
  FROM entities e
  WHERE NOT (e.path IS NOT NULL AND e.is_cited = 1 AND instr(e.meta, char(10)) = 0)
  GROUP BY COALESCE(e.parent_id, 0), entity_key(e.meta) HAVING COUNT(*) > 1
);

-- ============ 硬校验 ============
-- @check | integrity | integrity_check | hard | | ok
PRAGMA integrity_check;
-- @check | fk | foreign_key_check | hard | | zero
PRAGMA foreign_key_check;

-- ============ ① is_cited 与 link 入边一致（spec §3.1）============
-- @check | 1 | is_cited 与 link 入边一致 | modern | entities.meta,entities.is_cited,edges.kind | zero
SELECT e.id FROM entities e
WHERE e.is_cited <> EXISTS(SELECT 1 FROM edges x WHERE x.target_id = e.id AND x.kind = 'link');

-- ============ ② 缓存 parent_id 与 child 入边一致（spec §3.7-2，去 kind='tag'）============
-- @check | 2 | parent_id 与 child 入边一致 | modern | entities.meta,entities.is_cited,entities.parent_id,edges.kind | zero
SELECT e.id, e.path FROM entities e
LEFT JOIN edges c ON c.kind = 'child' AND c.target_id = e.id
WHERE e.parent_id IS NOT c.source_id;

-- ============ ③ path 缓存与「父 path + '/' + entity_name」推导一致（spec §3.7-3）============
-- @check | 3 | path 与推导一致 | modern | entities.meta,entities.is_cited,entities.path,entities.parent_id,edges.kind | zero
WITH RECURSIVE w(id, p) AS (
  SELECT id, entity_name(meta) FROM entities WHERE parent_id IS NULL AND path IS NOT NULL
  UNION ALL
  SELECT e.id, w.p || '/' || entity_name(e.meta) FROM entities e JOIN w ON e.parent_id = w.id
)
SELECT e.id, e.path, w.p FROM entities e JOIN w ON w.id = e.id
WHERE e.path IS NOT NULL AND e.path <> w.p;

-- ============ ④ depth 缓存与 child 边推导深度一致（spec §3.7-4）============
-- @check | 4 | depth 与推导一致 | modern | entities.meta,entities.is_cited,entities.depth,entities.path,entities.parent_id,edges.kind | zero
WITH RECURSIVE w(id, d) AS (
  SELECT id, 1 FROM entities WHERE parent_id IS NULL AND path IS NOT NULL
  UNION ALL
  SELECT e.id, w.d + 1 FROM entities e JOIN w ON e.parent_id = w.id
)
SELECT e.id, e.depth, w.d FROM entities e JOIN w ON w.id = e.id
WHERE e.path IS NOT NULL AND e.depth <> w.d;

-- ============ ⑤ child 边入度不超过 1（spec §3.7-5）============
-- @check | 5 | child 入度不超过 1 | modern | entities.meta,entities.is_cited,edges.kind | zero
SELECT target_id, COUNT(*) FROM edges WHERE kind = 'child' GROUP BY target_id HAVING COUNT(*) > 1;

-- ============ ⑥ 同父同键唯一（spec §3.7-6，按 P0-2 收窄到自动合并作用域）============
-- @check | 6 | 同父同键唯一(自动合并作用域) | modern | entities.meta,entities.is_cited,entities.path,entities.parent_id | zero
SELECT COALESCE(e.parent_id, 0), entity_key(e.meta), COUNT(*) FROM entities e
WHERE e.path IS NOT NULL AND e.is_cited = 1 AND instr(e.meta, char(10)) = 0
GROUP BY COALESCE(e.parent_id, 0), entity_key(e.meta) HAVING COUNT(*) > 1;

-- ============ ⑦ id 完整性：非空 / 唯一 / MIN>=1（连号只在没发生过合并的库上要求）============
-- 口径（2026-10-11 放宽）：合并会删实体，id 必然断号，恒 FAIL 会掩盖真问题。故硬性断言只剩
-- 非空 / 唯一 / MIN>=1；连号仅在 entity_merge_log 为空（从未合并）时才要求。断号处数另有
-- id_gaps 计数读数，formatReport 会打 INFO「检测到 N 处断号（合并态，允许）」。
-- @check | 7 | id 非空唯一且 MIN>=1(无合并记录时还要求连号) | modern | entities.meta,entities.is_cited,entity_merge_log | zero
WITH st AS (SELECT MIN(id) AS min_id, MAX(id) AS max_id, COUNT(*) AS total,
                   COUNT(DISTINCT id) AS distinct_total FROM entities),
     gp AS (SELECT COUNT(*) AS gaps FROM (SELECT id, LAG(id) OVER (ORDER BY id) AS prev FROM entities)
             WHERE prev IS NOT NULL AND id <> prev + 1),
     mg AS (SELECT COUNT(*) AS merges FROM entity_merge_log)
SELECT st.min_id, st.max_id, st.total, st.distinct_total, gp.gaps, mg.merges FROM st, gp, mg
WHERE st.min_id < 1 OR st.total <> st.distinct_total
   OR (mg.merges = 0 AND (st.min_id <> 1 OR gp.gaps > 0));
