-- LifeLog 点/线重构（v31）· 对账唯一真源（spec docs/superpowers/specs/2026-10-10-point-line-design.md §5.4 十条 + §10.3 读数）
--
-- 执行方：
--   * scripts/entity-migration/reconcile.mjs（python sqlite3，mode=ro；运行器内置 entity_name / entity_key 同口径实现）
--   * Rust src-tauri/src/db/repos/entities/reconcile.rs（include_str! 同一文件；entity_name / entity_key 由连接注册）
-- 标记块：语句块以一个标记行开头，到下一个标记行或文件末尾结束；块内只放一条 SQL 语句。
--   -- @count | <键> | <需要的表或列>                 计数读数（只打印，不判 PASS/FAIL）
--   -- @check | <序号> | <标题> | <模式> | <需要的表或列> | <期望>   对账；期望 = zero（0 行通过）或 ok（单行 'ok' 通过）
-- 「需要的表或列」为逗号分隔：table 或 table.column；任一表/列不存在则整块打印 N/A。
-- 十条（①–⑩）统一要求 v31 结构（points / lines / settings / points_fts）；v30 旧库（entities / edges）整组 N/A，不报错。
-- 保留点 `子级` id = 0（spec §14 P1）；无名哨兵 COALESCE(name_id, -1)；TREE 常量 = 0。
-- ⑦ 的连号只在「无合并记录」的库上要求（2026-10-11 放宽）：自动合并与引用优化 A3 都会删点，断号是常态。
-- 真库只读：本文件只允许 SELECT / 只读 PRAGMA，禁止任何写语句。

-- ============ 计数读数 v30（旧结构；迁移前基线，验收要求 entities / edges 仍有读数）============
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
-- @count | entities_path_nonnull | entities.path
SELECT COUNT(*) FROM entities WHERE path IS NOT NULL;
-- @count | entities_path_null | entities.path
SELECT COUNT(*) FROM entities WHERE path IS NULL;
-- @count | edges | edges
SELECT COUNT(*) FROM edges;
-- @count | entities_fts | entities_fts
SELECT COUNT(*) FROM entities_fts;
-- @count | id_gaps | entities
SELECT COUNT(*) FROM (SELECT id, LAG(id) OVER (ORDER BY id) AS prev FROM entities) WHERE prev IS NOT NULL AND id <> prev + 1;
-- @count | id_merge_log | entity_merge_log
SELECT COUNT(*) FROM entity_merge_log;
-- @count | entity_aliases | entity_aliases
SELECT COUNT(*) FROM entity_aliases;
-- @count | is_cited | entities.is_cited
SELECT COUNT(*) FROM entities WHERE is_cited = 1;
-- @count | tree_closure | entities.is_cited
WITH RECURSIVE c(id) AS (SELECT id FROM entities WHERE is_cited = 1 UNION SELECT x.source_id FROM edges x JOIN c ON c.id = x.target_id WHERE x.kind = 'child') SELECT COUNT(*) FROM c;
-- @count | feed_default | entities.is_cited
WITH RECURSIVE c(id) AS (SELECT id FROM entities WHERE is_cited = 1 UNION SELECT x.source_id FROM edges x JOIN c ON c.id = x.target_id WHERE x.kind = 'child') SELECT COUNT(*) FROM entities e WHERE NOT (e.id IN (SELECT id FROM c) AND instr(e.meta, char(10)) = 0);

-- ============ 计数读数 v31（points / lines 口径）============
-- @count | points | points
SELECT COUNT(*) FROM points;
-- @count | points_min_id | points
SELECT MIN(id) FROM points;
-- @count | points_max_id | points
SELECT MAX(id) FROM points;
-- @count | points_distinct_id | points
SELECT COUNT(DISTINCT id) FROM points;
-- @count | points_path_nonnull | points.path
SELECT COUNT(*) FROM points WHERE path IS NOT NULL;
-- @count | points_path_null | points.path
SELECT COUNT(*) FROM points WHERE path IS NULL;
-- @count | id_gaps_points | points
SELECT COUNT(*) FROM (SELECT id, LAG(id) OVER (ORDER BY id) AS prev FROM points) WHERE prev IS NOT NULL AND id <> prev + 1;
-- @count | lines | lines
SELECT COUNT(*) FROM lines;
-- @count | lines_tree | lines.name_id
SELECT COUNT(*) FROM lines WHERE name_id = 0;
-- @count | lines_named | lines.name_id
SELECT COUNT(*) FROM lines WHERE name_id IS NOT NULL AND name_id <> 0;
-- @count | lines_unnamed | lines.name_id
SELECT COUNT(*) FROM lines WHERE name_id IS NULL;
-- @count | lines_dup_triple | lines.from_id,lines.to_id,lines.name_id
SELECT COUNT(*) FROM (SELECT 1 FROM lines GROUP BY from_id, to_id, COALESCE(name_id, -1) HAVING COUNT(*) > 1);
-- @count | lines_dangling | lines.from_id,lines.to_id,lines.name_id
SELECT COUNT(*) FROM lines l WHERE NOT EXISTS(SELECT 1 FROM points p WHERE p.id = l.from_id) OR NOT EXISTS(SELECT 1 FROM points p WHERE p.id = l.to_id) OR (l.name_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM points p WHERE p.id = l.name_id));
-- @count | pure_name_points | points.meta,lines.name_id
SELECT COUNT(*) FROM points p WHERE EXISTS(SELECT 1 FROM lines n WHERE n.name_id = p.id) AND NOT EXISTS(SELECT 1 FROM lines t WHERE t.from_id = p.id OR t.to_id = p.id);
-- @count | points_fts | points_fts
SELECT COUNT(*) FROM points_fts;
-- @count | is_cited_points | points.is_cited
SELECT COUNT(*) FROM points WHERE is_cited = 1;
-- @count | tree_closure_points | points.is_cited
WITH RECURSIVE c(id) AS (SELECT id FROM points WHERE is_cited = 1 UNION SELECT x.from_id FROM lines x JOIN c ON c.id = x.to_id WHERE x.name_id = 0) SELECT COUNT(*) FROM c;
-- @count | feed_default_points | points.is_cited
WITH RECURSIVE c(id) AS (SELECT id FROM points WHERE is_cited = 1 UNION SELECT x.from_id FROM lines x JOIN c ON c.id = x.to_id WHERE x.name_id = 0) SELECT COUNT(*) FROM points p WHERE NOT (EXISTS(SELECT 1 FROM lines n WHERE n.name_id = p.id) AND NOT EXISTS(SELECT 1 FROM lines t WHERE t.from_id = p.id OR t.to_id = p.id)) AND NOT (p.id IN (SELECT id FROM c) AND instr(p.meta, char(10)) = 0);

-- ============ 硬校验 ============
-- @check | integrity | integrity_check | hard | | ok
PRAGMA integrity_check;
-- @check | fk | foreign_key_check | hard | | zero
PRAGMA foreign_key_check;

-- ============ ① is_cited 与「非子级线」入边一致（spec §5.4-①）============
-- @check | 1 | is_cited 与非子级线入边一致 | modern | points.is_cited,lines.to_id,lines.name_id | zero
SELECT p.id FROM points p WHERE p.is_cited <> EXISTS(SELECT 1 FROM lines x WHERE x.to_id = p.id AND (x.name_id IS NULL OR x.name_id <> 0));

-- ============ ② 缓存 parent_id 与子级线入边一致（spec §5.4-②）============
-- @check | 2 | parent_id 与子级线入边一致 | modern | points.parent_id,lines.name_id,lines.to_id,lines.from_id | zero
SELECT p.id, p.path FROM points p LEFT JOIN lines c ON c.name_id = 0 AND c.to_id = p.id WHERE p.parent_id IS NOT c.from_id;

-- ============ ③ path 缓存与「父 path + '/' + entity_name」推导一致（spec §5.4-③）============
-- @check | 3 | path 与推导一致 | modern | points.meta,points.path,points.parent_id | zero
WITH RECURSIVE w(id, p) AS (SELECT id, entity_name(meta) FROM points WHERE parent_id IS NULL AND path IS NOT NULL UNION ALL SELECT e.id, w.p || '/' || entity_name(e.meta) FROM points e JOIN w ON e.parent_id = w.id) SELECT e.id, e.path, w.p FROM points e JOIN w ON w.id = e.id WHERE e.path IS NOT NULL AND e.path <> w.p;

-- ============ ④ depth 缓存与子级线推导深度一致（spec §5.4-④）============
-- @check | 4 | depth 与推导一致 | modern | points.depth,points.path,points.parent_id | zero
WITH RECURSIVE w(id, d) AS (SELECT id, 1 FROM points WHERE parent_id IS NULL AND path IS NOT NULL UNION ALL SELECT e.id, w.d + 1 FROM points e JOIN w ON e.parent_id = w.id) SELECT e.id, e.depth, w.d FROM points e JOIN w ON w.id = e.id WHERE e.path IS NOT NULL AND e.depth <> w.d;

-- ============ ⑤ 子级线入度不超过 1（spec §5.4-⑤）============
-- @check | 5 | 子级线入度不超过 1 | modern | lines.name_id,lines.to_id | zero
SELECT to_id, COUNT(*) FROM lines WHERE name_id = 0 GROUP BY to_id HAVING COUNT(*) > 1;

-- ============ ⑥ 同父同键唯一（自动合并作用域，spec §5.4-⑥）============
-- @check | 6 | 同父同键唯一(自动合并作用域) | modern | points.meta,points.is_cited,points.path,points.parent_id | zero
SELECT COALESCE(p.parent_id, 0), entity_key(p.meta), COUNT(*) FROM points p WHERE p.path IS NOT NULL AND p.is_cited = 1 AND instr(p.meta, char(10)) = 0 GROUP BY COALESCE(p.parent_id, 0), entity_key(p.meta) HAVING COUNT(*) > 1;

-- ============ ⑦ id 完整性：内容点（非纯名字点）非空 / 唯一 / MIN>=1（连号只在没合并过的库上要求）============
-- 保留点 `子级`（id = 0）必须显式排除：空树库里它没有名字位、位置判据不成立，仍会落入内容点集合把 MIN 拉到 0（T1.2 报的缺口）。
-- 关系名字点（纯名字点）由位置判据排除；断号处数另有 id_gaps_points 读数。
-- @check | 7 | 内容点 id 非空唯一且 MIN>=1(无合并记录时还要求连号) | modern | points.meta,points.is_cited,lines.name_id,lines.from_id,lines.to_id,entity_merge_log | zero
WITH cp AS (SELECT p.id FROM points p WHERE p.id <> 0 AND NOT (EXISTS(SELECT 1 FROM lines n WHERE n.name_id = p.id) AND NOT EXISTS(SELECT 1 FROM lines t WHERE t.from_id = p.id OR t.to_id = p.id))),
     st AS (SELECT MIN(id) AS min_id, COUNT(*) AS total, COUNT(DISTINCT id) AS distinct_total FROM cp),
     gp AS (SELECT COUNT(*) AS gaps FROM (SELECT id, LAG(id) OVER (ORDER BY id) AS prev FROM cp) WHERE prev IS NOT NULL AND id <> prev + 1),
     mg AS (SELECT COUNT(*) AS merges FROM entity_merge_log)
SELECT st.min_id, st.total, st.distinct_total, gp.gaps, mg.merges FROM st, gp, mg WHERE st.min_id < 1 OR st.total <> st.distinct_total OR (mg.merges = 0 AND (st.min_id <> 1 OR gp.gaps > 0));

-- ============ ⑧ 纯名字点只在名字位、四属性为零、不进 FTS；名字引用无悬挂（spec §5.4-⑧）============
-- 纯名字点 := 出现在某条线 name_id 位、且不出现在任何线两端（位置判据）。它们在 is_cited=0 / path NULL / parent NULL 时
-- 天然不进闭包，也不会出现在信息流基集；FTS 由 points_fts_src 的 NOT_PURE_NAME 保证，这里断言其未泄漏。
-- @check | 8 | 纯名字点属性健全且名字引用无悬挂 | modern | points.meta,points.path,points.parent_id,points.is_cited,points_fts,lines.name_id,lines.from_id,lines.to_id | zero
SELECT p.id, 'profile' FROM points p WHERE (EXISTS(SELECT 1 FROM lines n WHERE n.name_id = p.id) AND NOT EXISTS(SELECT 1 FROM lines t WHERE t.from_id = p.id OR t.to_id = p.id)) AND (p.path IS NOT NULL OR p.parent_id IS NOT NULL OR p.is_cited <> 0 OR EXISTS(SELECT 1 FROM points_fts f WHERE f.rowid = p.id))
UNION ALL
SELECT l.id, 'dangling_name' FROM lines l WHERE l.name_id IS NOT NULL AND l.name_id <> 0 AND NOT EXISTS(SELECT 1 FROM points n WHERE n.id = l.name_id);

-- ============ ⑨ 保留点 子级 健全：settings.tree_line_name_id 指向 id = 0 且 meta = '子级'（spec §5.4-⑨）============
-- @check | 9 | 保留点健全(settings 指向 id=0 且 meta='子级') | modern | points.meta,points.path,points.parent_id,points.is_cited,settings.key,settings.value | zero
SELECT 'settings_missing' WHERE NOT EXISTS(SELECT 1 FROM settings WHERE key = 'tree_line_name_id' AND CAST(value AS INTEGER) = 0)
UNION ALL
SELECT 'reserved_point_bad' WHERE NOT EXISTS(SELECT 1 FROM points WHERE id = 0 AND meta = '子级' AND path IS NULL AND parent_id IS NULL AND is_cited = 0);

-- ============ ⑩ settings 快照键健全：graph_positions 键集 / ui.mru.notes 值集不悬挂、非名字点（spec §5.4-⑩）============
-- 完全「逐字与迁移前快照相同」不可在纯 SQL 内表达，由 T1.5 / T2.5 对照 p31 快照完成；此处断言可机器判定的部分：
-- 每个引用 id 都存在，且没有引用落到纯名字点（名字点 id 区间是迁移新增段）。
-- @check | 10 | settings 快照键有效(graph_positions/ui.mru.notes) | modern | settings.key,settings.value,points.meta,lines.name_id,lines.from_id,lines.to_id | zero
WITH s AS (SELECT key, CASE WHEN json_valid(value) THEN value ELSE 'null' END AS value FROM settings WHERE key IN ('graph_positions', 'ui.mru.notes')),
     refs AS (SELECT j.key AS ref FROM s, json_each(s.value) j WHERE s.key = 'graph_positions' UNION ALL SELECT CAST(json_extract(j.value, '$.id') AS INTEGER) FROM s, json_each(s.value) j WHERE s.key = 'ui.mru.notes')
SELECT r.ref FROM refs r WHERE NOT EXISTS(SELECT 1 FROM points p WHERE p.id = r.ref) OR EXISTS(SELECT 1 FROM points p WHERE p.id = r.ref AND EXISTS(SELECT 1 FROM lines n WHERE n.name_id = p.id) AND NOT EXISTS(SELECT 1 FROM lines t WHERE t.from_id = p.id OR t.to_id = p.id));
