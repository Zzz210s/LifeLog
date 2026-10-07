-- LifeLog 统一实体迁移 · 对账唯一真源（spec docs/superpowers/specs/2026-10-07-unified-entities-design.md §3 ①–⑤）
--
-- 由 scripts/entity-migration/reconcile.mjs 解析执行；Rust 侧 Task 1.3 以 include_str! 引用同一文件。
-- 每个语句块以一个标记行开头，到下一个标记行或文件末尾结束；块内只放一条 SQL 语句。
--   -- @count | <键> | <需要的表>                  计数读数（只打印，不判 PASS/FAIL）
--   -- @check | <序号> | <标题> | <模式> | <需要的表> | <期望>   对账；期望 = zero（0 行通过）或 ok（单行 'ok' 通过）
-- <需要的表> 为逗号分隔的表名；任一不存在则整块打印 N/A。legacy 模式对老表，modern 模式对 entities/edges。
-- 真库只读：本文件只允许 SELECT / PRAGMA 只读查询，禁止任何写语句。

-- ============ 计数读数 ============
-- @count | user_version | 
PRAGMA user_version;
-- @count | notes | notes
SELECT COUNT(*) FROM notes;
-- @count | tags | tags
SELECT COUNT(*) FROM tags;
-- @count | tag_links | tag_links
SELECT COUNT(*) FROM tag_links;
-- @count | tag_links_note | tag_links
SELECT COUNT(*) FROM tag_links WHERE target_type = 'note';
-- @count | tag_links_tag | tag_links
SELECT COUNT(*) FROM tag_links WHERE target_type IN ('tag', 'type');
-- @count | note_links | note_links
SELECT COUNT(*) FROM note_links;
-- @count | notes_fts | notes_fts
SELECT COUNT(*) FROM notes_fts;
-- @count | tag_aliases | tag_aliases
SELECT COUNT(*) FROM tag_aliases;
-- @count | tag_merge_log | tag_merge_log
SELECT COUNT(*) FROM tag_merge_log;
-- @count | entities | entities
SELECT COUNT(*) FROM entities;
-- @count | entities_tag | entities
SELECT COUNT(*) FROM entities WHERE kind = 'tag';
-- @count | entities_note | entities
SELECT COUNT(*) FROM entities WHERE kind = 'note';
-- @count | edges | edges
SELECT COUNT(*) FROM edges;
-- @count | edges_child | edges
SELECT COUNT(*) FROM edges WHERE kind = 'child';
-- @count | edges_tagging | edges
SELECT COUNT(*) FROM edges WHERE kind = 'tagging';
-- @count | edges_relation | edges
SELECT COUNT(*) FROM edges WHERE kind = 'relation';
-- @count | edges_link | edges
SELECT COUNT(*) FROM edges WHERE kind = 'link';
-- @count | entities_fts | entities_fts
SELECT COUNT(*) FROM entities_fts;

-- ============ 硬校验 ============
-- @check | integrity | integrity_check | hard | | ok
PRAGMA integrity_check;
-- @check | fk | foreign_key_check | hard | | zero
PRAGMA foreign_key_check;

-- ============ ① 缓存 parent_id 与 child 边一致 ============
-- @check | 1 | 缓存 parent_id 与 child 边一致 | legacy | tags | zero
SELECT t.id, t.parent_id FROM tags t
LEFT JOIN tags p ON p.id = t.parent_id
WHERE t.parent_id IS NOT NULL AND p.id IS NULL;
-- @check | 1 | 缓存 parent_id 与 child 边一致 | modern | entities,edges | zero
SELECT e.id, e.path FROM entities e
LEFT JOIN edges c ON c.kind = 'child' AND c.target_id = e.id
WHERE e.kind = 'tag' AND e.parent_id IS NOT c.source_id;

-- ============ ② path 缓存与 child 边推导路径一致 ============
-- @check | 2 | path 缓存与推导路径一致 | legacy | tags | zero
WITH RECURSIVE w(id, p) AS (
  SELECT id, name FROM tags WHERE parent_id IS NULL
  UNION ALL SELECT t.id, w.p || '/' || t.name FROM tags t JOIN w ON t.parent_id = w.id
)
SELECT t.id, t.path, w.p FROM tags t JOIN w ON w.id = t.id WHERE t.path <> w.p;
-- @check | 2 | path 缓存与推导路径一致 | modern | entities,edges | zero
WITH RECURSIVE w(id, p) AS (
  SELECT id, name FROM entities WHERE kind = 'tag' AND parent_id IS NULL
  UNION ALL SELECT e.id, w.p || '/' || e.name FROM entities e JOIN w ON e.parent_id = w.id
)
SELECT e.id, e.path, w.p FROM entities e JOIN w ON w.id = e.id WHERE e.kind = 'tag' AND e.path <> w.p;

-- ============ ③ depth 缓存与 child 边推导深度一致 ============
-- @check | 3 | depth 缓存与推导深度一致 | legacy | tags | zero
WITH RECURSIVE w(id, d) AS (
  SELECT id, 1 FROM tags WHERE parent_id IS NULL
  UNION ALL SELECT t.id, w.d + 1 FROM tags t JOIN w ON t.parent_id = w.id
)
SELECT t.id, t.depth, w.d FROM tags t JOIN w ON w.id = t.id WHERE t.depth <> w.d;
-- @check | 3 | depth 缓存与推导深度一致 | modern | entities,edges | zero
WITH RECURSIVE w(id, d) AS (
  SELECT id, 1 FROM entities WHERE kind = 'tag' AND parent_id IS NULL
  UNION ALL SELECT e.id, w.d + 1 FROM entities e JOIN w ON e.parent_id = w.id
)
SELECT e.id, e.depth, w.d FROM entities e JOIN w ON w.id = e.id WHERE e.kind = 'tag' AND e.depth <> w.d;

-- ============ ④ 单亲约束（同父同名 / child 边入度 <= 1）============
-- @check | 4 | 同一父节点下名字唯一 | legacy | tags | zero
SELECT COALESCE(parent_id, 0) AS p, name, COUNT(*) FROM tags GROUP BY p, name HAVING COUNT(*) > 1;
-- @check | 4 | child 边入度不超过 1 | modern | entities,edges | zero
SELECT target_id, COUNT(*) FROM edges WHERE kind = 'child' GROUP BY target_id HAVING COUNT(*) > 1;

-- ============ ⑤ 无悬挂引用 ============
-- @check | 5 | 无悬挂链接引用 | legacy | tags,tag_links,notes | zero
SELECT l.tag_id, l.target_type, l.target_id FROM tag_links l
LEFT JOIN tags s ON s.id = l.tag_id
LEFT JOIN notes n ON n.id = l.target_id AND l.target_type = 'note'
LEFT JOIN tags tt ON tt.id = l.target_id AND l.target_type IN ('tag', 'type')
WHERE s.id IS NULL OR (l.target_type = 'note' AND n.id IS NULL)
   OR (l.target_type IN ('tag', 'type') AND tt.id IS NULL);
-- @check | 5 | child 边指向存在的标签实体 | modern | entities,edges | zero
SELECT c.id, c.source_id, c.target_id FROM edges c
WHERE c.kind = 'child'
  AND NOT EXISTS (SELECT 1 FROM entities e WHERE e.id = c.target_id AND e.kind = 'tag');
