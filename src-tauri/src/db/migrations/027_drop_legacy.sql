-- 027: 统一实体第四步 —— 删净兼容层。
--
-- 三件事(顺序不能换):
-- ① **漂移回填**:阶段 3 快照后应用仍可能往老表写过行(真库实测 notes=1373 而
--    entities(kind='note')=1372、tags=742 而 entities(kind='tag')=740)。先按 024/025 的
--    同一口径把老表里还没进新表的行补进来,再下架 —— 否则会丢用户的笔记/标签。
-- ② 重建 `entities_fts` 的 9 个触发器(聚合表达式**内联**),然后 DROP VIEW `entities_fts_src`。
--    026 把聚合的唯一 SQL 实现放在视图里给触发器/重建共用;阶段 4 该视图是过渡残留,
--    必须随 026 触发器一起下架,再以同一段表达式重建触发器(否则触发器引用不存在的视图)。
-- ③ 删净老表/老触发器/老 FTS/老别名与合并日志/过渡列(`entity_merge_log` 由 `tag_merge_log`
--    按 D7 改名并翻译 id;`entities.legacy_id` 由 Rust 钩子按列存在性 DROP)。
--
-- 漂移回填全部 `INSERT OR IGNORE`:两段 id 区间永久不撞,不会覆盖新表已有行。
-- 可崩溃重放:`migrate::apply` 把本文件与 `user_version` 放同一事务,失败整批回滚;
-- 重跑时版本闸门已到 27 直接跳过。`entity_merge_log` 用 `IF NOT EXISTS`。

-- ============ ① 漂移回填(老表 -> 新表)============
-- 笔记:老 notes.id 原值(name=NULL;legacy_id 即将随列一起下架,不再写)
INSERT OR IGNORE INTO entities(id, kind, name, content, created_at, color, parent_id, path, depth, sort_order)
SELECT n.id, 'note', NULL, n.content, n.created_at, NULL, NULL, NULL, NULL, 0
FROM notes n;

-- 标签:标签 id 整体偏移(与 024 同一字面量,守卫用例钉住)
INSERT OR IGNORE INTO entities(id, kind, name, content, created_at, color, parent_id, path, depth, sort_order)
SELECT t.id + 1000000000, 'tag', t.name, '',
       strftime('%Y-%m-%dT%H:%M:%f','now','localtime'),
       t.color, t.parent_id + 1000000000, t.path, t.depth, t.sort_order
FROM tags t;

-- child 边:父 -> 子(两端偏移)
INSERT OR IGNORE INTO edges(source_id, target_id, kind, remark, created_at)
SELECT t.parent_id + 1000000000, t.id + 1000000000, 'child', '',
       strftime('%Y-%m-%dT%H:%M:%f','now','localtime')
FROM tags t WHERE t.parent_id IS NOT NULL;

-- tagging 边:笔记 -> 标签(老 tag_links 是标签->笔记,逐行翻转)
INSERT OR IGNORE INTO edges(source_id, target_id, kind, remark, created_at)
SELECT l.target_id, l.tag_id + 1000000000, 'tagging', '',
       strftime('%Y-%m-%dT%H:%M:%f','now','localtime')
FROM tag_links l
WHERE l.target_type = 'note'
  AND EXISTS (SELECT 1 FROM notes n WHERE n.id = l.target_id)
  AND EXISTS (SELECT 1 FROM tags t WHERE t.id = l.tag_id);

-- relation 边:标签 -> 标签
INSERT OR IGNORE INTO edges(source_id, target_id, kind, remark, created_at)
SELECT l.tag_id + 1000000000, l.target_id + 1000000000, 'relation', COALESCE(l.remark, ''),
       strftime('%Y-%m-%dT%H:%M:%f','now','localtime')
FROM tag_links l
WHERE l.target_type IN ('tag', 'type')
  AND EXISTS (SELECT 1 FROM tags s WHERE s.id = l.tag_id)
  AND EXISTS (SELECT 1 FROM tags d WHERE d.id = l.target_id);

-- link 边:实体 -> 实体(两端原值;未解析 target_id IS NULL 不落边)
INSERT OR IGNORE INTO edges(source_id, target_id, kind, remark, created_at)
SELECT l.source_id, l.target_id, 'link', '',
       strftime('%Y-%m-%dT%H:%M:%f','now','localtime')
FROM note_links l
WHERE l.target_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM notes s WHERE s.id = l.source_id)
  AND EXISTS (SELECT 1 FROM notes d WHERE d.id = l.target_id);

-- 别名表漂移(026 回填后又登记过的)
INSERT OR IGNORE INTO entity_aliases(alias, entity_id)
SELECT a.alias, a.tag_id + 1000000000
FROM tag_aliases a
WHERE EXISTS (SELECT 1 FROM entities e WHERE e.id = a.tag_id + 1000000000);

-- ============ ② 合并日志改名(D7:`tag_merge_log` -> `entity_merge_log`)============
CREATE TABLE IF NOT EXISTS entity_merge_log (
  id                INTEGER PRIMARY KEY,
  source_entity_id  INTEGER NOT NULL,
  target_entity_id  INTEGER NOT NULL,
  moved_child_ids   TEXT    NOT NULL DEFAULT '[]',
  note_links        INTEGER NOT NULL DEFAULT 0,
  edges             INTEGER NOT NULL DEFAULT 0,
  at                TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
-- 只搬 id 与计数;`moved_child_ids` 是排查日志(JSON 老 id 列表),不参与任何语义,原样保留。
INSERT OR IGNORE INTO entity_merge_log
  (id, source_entity_id, target_entity_id, moved_child_ids, note_links, edges, at)
SELECT id, source_tag_id + 1000000000, target_tag_id + 1000000000,
       moved_child_ids, note_links, edges, at
FROM tag_merge_log;

-- ============ ③ 重建 9 个 FTS 触发器(聚合内联,不再依赖视图)============
-- 聚合表达式与 Rust 真源 `repos/entities/fts.rs::ENTITIES_AGG` 逐段一致
-- (守卫用例 `drop_legacy_migration_tests::agg_segments_appear_in_027_text`)。

DROP TRIGGER IF EXISTS entities_ai;
CREATE TRIGGER entities_ai AFTER INSERT ON entities BEGIN
  INSERT INTO entities_fts(rowid, name, content, tag_paths)
  SELECT e.id, COALESCE(e.name, ''), e.content, trim(CASE WHEN e.kind = 'note' THEN COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path) FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id WHERE l.source_id = e.id), '') || COALESCE(' ' || (SELECT group_concat(tag_plain(t.path), ' ' ORDER BY t.path) FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id WHERE l.source_id = e.id AND tag_plain(t.path) <> t.path), '') || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) FROM entity_aliases a WHERE a.entity_id IN (SELECT l2.target_id FROM edges l2 WHERE l2.kind = 'tagging' AND l2.source_id = e.id)), '') ELSE COALESCE(e.path, '') || COALESCE(' ' || (SELECT tag_plain(e.path) WHERE tag_plain(e.path) <> e.path), '') || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) FROM entity_aliases a WHERE a.entity_id = e.id), '') END) FROM entities e WHERE e.id = new.id;
END;

DROP TRIGGER IF EXISTS entities_ad;
CREATE TRIGGER entities_ad AFTER DELETE ON entities BEGIN
  DELETE FROM entities_fts WHERE rowid = old.id;
END;

DROP TRIGGER IF EXISTS entities_au;
CREATE TRIGGER entities_au AFTER UPDATE OF content, name, path ON entities BEGIN
  DELETE FROM entities_fts WHERE rowid IN (
    WITH RECURSIVE sub(id) AS (
      SELECT new.id
      UNION SELECT g.target_id FROM edges g JOIN sub ON g.source_id = sub.id AND g.kind = 'child'
    )
    SELECT id FROM sub
    UNION SELECT l.source_id FROM edges l JOIN sub ON l.target_id = sub.id AND l.kind = 'tagging'
  );
  INSERT INTO entities_fts(rowid, name, content, tag_paths)
  SELECT e.id, COALESCE(e.name, ''), e.content, trim(CASE WHEN e.kind = 'note' THEN COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path) FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id WHERE l.source_id = e.id), '') || COALESCE(' ' || (SELECT group_concat(tag_plain(t.path), ' ' ORDER BY t.path) FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id WHERE l.source_id = e.id AND tag_plain(t.path) <> t.path), '') || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) FROM entity_aliases a WHERE a.entity_id IN (SELECT l2.target_id FROM edges l2 WHERE l2.kind = 'tagging' AND l2.source_id = e.id)), '') ELSE COALESCE(e.path, '') || COALESCE(' ' || (SELECT tag_plain(e.path) WHERE tag_plain(e.path) <> e.path), '') || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) FROM entity_aliases a WHERE a.entity_id = e.id), '') END) FROM entities e WHERE e.id IN (
    WITH RECURSIVE sub(id) AS (
      SELECT new.id
      UNION SELECT g.target_id FROM edges g JOIN sub ON g.source_id = sub.id AND g.kind = 'child'
    )
    SELECT id FROM sub
    UNION SELECT l.source_id FROM edges l JOIN sub ON l.target_id = sub.id AND l.kind = 'tagging'
  );
END;

DROP TRIGGER IF EXISTS edges_ai;
CREATE TRIGGER edges_ai AFTER INSERT ON edges BEGIN
  DELETE FROM entities_fts WHERE rowid IN (
    SELECT new.source_id WHERE new.kind = 'tagging'
    UNION SELECT new.source_id WHERE new.kind IN ('child', 'relation')
    UNION SELECT new.target_id WHERE new.kind IN ('child', 'relation')
  );
  INSERT INTO entities_fts(rowid, name, content, tag_paths)
  SELECT e.id, COALESCE(e.name, ''), e.content, trim(CASE WHEN e.kind = 'note' THEN COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path) FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id WHERE l.source_id = e.id), '') || COALESCE(' ' || (SELECT group_concat(tag_plain(t.path), ' ' ORDER BY t.path) FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id WHERE l.source_id = e.id AND tag_plain(t.path) <> t.path), '') || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) FROM entity_aliases a WHERE a.entity_id IN (SELECT l2.target_id FROM edges l2 WHERE l2.kind = 'tagging' AND l2.source_id = e.id)), '') ELSE COALESCE(e.path, '') || COALESCE(' ' || (SELECT tag_plain(e.path) WHERE tag_plain(e.path) <> e.path), '') || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) FROM entity_aliases a WHERE a.entity_id = e.id), '') END) FROM entities e WHERE e.id IN (
    SELECT new.source_id WHERE new.kind = 'tagging'
    UNION SELECT new.source_id WHERE new.kind IN ('child', 'relation')
    UNION SELECT new.target_id WHERE new.kind IN ('child', 'relation')
  );
END;

DROP TRIGGER IF EXISTS edges_ad;
CREATE TRIGGER edges_ad AFTER DELETE ON edges BEGIN
  DELETE FROM entities_fts WHERE rowid IN (
    SELECT old.source_id WHERE old.kind = 'tagging'
    UNION SELECT old.source_id WHERE old.kind IN ('child', 'relation')
    UNION SELECT old.target_id WHERE old.kind IN ('child', 'relation')
  );
  INSERT INTO entities_fts(rowid, name, content, tag_paths)
  SELECT e.id, COALESCE(e.name, ''), e.content, trim(CASE WHEN e.kind = 'note' THEN COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path) FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id WHERE l.source_id = e.id), '') || COALESCE(' ' || (SELECT group_concat(tag_plain(t.path), ' ' ORDER BY t.path) FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id WHERE l.source_id = e.id AND tag_plain(t.path) <> t.path), '') || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) FROM entity_aliases a WHERE a.entity_id IN (SELECT l2.target_id FROM edges l2 WHERE l2.kind = 'tagging' AND l2.source_id = e.id)), '') ELSE COALESCE(e.path, '') || COALESCE(' ' || (SELECT tag_plain(e.path) WHERE tag_plain(e.path) <> e.path), '') || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) FROM entity_aliases a WHERE a.entity_id = e.id), '') END) FROM entities e WHERE e.id IN (
    SELECT old.source_id WHERE old.kind = 'tagging'
    UNION SELECT old.source_id WHERE old.kind IN ('child', 'relation')
    UNION SELECT old.target_id WHERE old.kind IN ('child', 'relation')
  );
END;

DROP TRIGGER IF EXISTS edges_au;
CREATE TRIGGER edges_au AFTER UPDATE ON edges BEGIN
  DELETE FROM entities_fts WHERE rowid IN (
    SELECT old.source_id WHERE old.kind = 'tagging'
    UNION SELECT old.source_id WHERE old.kind IN ('child', 'relation')
    UNION SELECT old.target_id WHERE old.kind IN ('child', 'relation')
    UNION SELECT new.source_id WHERE new.kind = 'tagging'
    UNION SELECT new.source_id WHERE new.kind IN ('child', 'relation')
    UNION SELECT new.target_id WHERE new.kind IN ('child', 'relation')
  );
  INSERT INTO entities_fts(rowid, name, content, tag_paths)
  SELECT e.id, COALESCE(e.name, ''), e.content, trim(CASE WHEN e.kind = 'note' THEN COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path) FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id WHERE l.source_id = e.id), '') || COALESCE(' ' || (SELECT group_concat(tag_plain(t.path), ' ' ORDER BY t.path) FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id WHERE l.source_id = e.id AND tag_plain(t.path) <> t.path), '') || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) FROM entity_aliases a WHERE a.entity_id IN (SELECT l2.target_id FROM edges l2 WHERE l2.kind = 'tagging' AND l2.source_id = e.id)), '') ELSE COALESCE(e.path, '') || COALESCE(' ' || (SELECT tag_plain(e.path) WHERE tag_plain(e.path) <> e.path), '') || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) FROM entity_aliases a WHERE a.entity_id = e.id), '') END) FROM entities e WHERE e.id IN (
    SELECT old.source_id WHERE old.kind = 'tagging'
    UNION SELECT old.source_id WHERE old.kind IN ('child', 'relation')
    UNION SELECT old.target_id WHERE old.kind IN ('child', 'relation')
    UNION SELECT new.source_id WHERE new.kind = 'tagging'
    UNION SELECT new.source_id WHERE new.kind IN ('child', 'relation')
    UNION SELECT new.target_id WHERE new.kind IN ('child', 'relation')
  );
END;

DROP TRIGGER IF EXISTS entity_aliases_ai;
CREATE TRIGGER entity_aliases_ai AFTER INSERT ON entity_aliases BEGIN
  DELETE FROM entities_fts WHERE rowid IN (
    SELECT new.entity_id
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'tagging' AND l.target_id = new.entity_id
  );
  INSERT INTO entities_fts(rowid, name, content, tag_paths)
  SELECT e.id, COALESCE(e.name, ''), e.content, trim(CASE WHEN e.kind = 'note' THEN COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path) FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id WHERE l.source_id = e.id), '') || COALESCE(' ' || (SELECT group_concat(tag_plain(t.path), ' ' ORDER BY t.path) FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id WHERE l.source_id = e.id AND tag_plain(t.path) <> t.path), '') || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) FROM entity_aliases a WHERE a.entity_id IN (SELECT l2.target_id FROM edges l2 WHERE l2.kind = 'tagging' AND l2.source_id = e.id)), '') ELSE COALESCE(e.path, '') || COALESCE(' ' || (SELECT tag_plain(e.path) WHERE tag_plain(e.path) <> e.path), '') || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) FROM entity_aliases a WHERE a.entity_id = e.id), '') END) FROM entities e WHERE e.id IN (
    SELECT new.entity_id
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'tagging' AND l.target_id = new.entity_id
  );
END;

DROP TRIGGER IF EXISTS entity_aliases_au;
CREATE TRIGGER entity_aliases_au AFTER UPDATE ON entity_aliases BEGIN
  DELETE FROM entities_fts WHERE rowid IN (
    SELECT old.entity_id UNION SELECT new.entity_id
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'tagging' AND l.target_id IN (old.entity_id, new.entity_id)
  );
  INSERT INTO entities_fts(rowid, name, content, tag_paths)
  SELECT e.id, COALESCE(e.name, ''), e.content, trim(CASE WHEN e.kind = 'note' THEN COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path) FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id WHERE l.source_id = e.id), '') || COALESCE(' ' || (SELECT group_concat(tag_plain(t.path), ' ' ORDER BY t.path) FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id WHERE l.source_id = e.id AND tag_plain(t.path) <> t.path), '') || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) FROM entity_aliases a WHERE a.entity_id IN (SELECT l2.target_id FROM edges l2 WHERE l2.kind = 'tagging' AND l2.source_id = e.id)), '') ELSE COALESCE(e.path, '') || COALESCE(' ' || (SELECT tag_plain(e.path) WHERE tag_plain(e.path) <> e.path), '') || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) FROM entity_aliases a WHERE a.entity_id = e.id), '') END) FROM entities e WHERE e.id IN (
    SELECT old.entity_id UNION SELECT new.entity_id
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'tagging' AND l.target_id IN (old.entity_id, new.entity_id)
  );
END;

DROP TRIGGER IF EXISTS entity_aliases_ad;
CREATE TRIGGER entity_aliases_ad AFTER DELETE ON entity_aliases BEGIN
  DELETE FROM entities_fts WHERE rowid IN (
    SELECT old.entity_id
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'tagging' AND l.target_id = old.entity_id
  );
  INSERT INTO entities_fts(rowid, name, content, tag_paths)
  SELECT e.id, COALESCE(e.name, ''), e.content, trim(CASE WHEN e.kind = 'note' THEN COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path) FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id WHERE l.source_id = e.id), '') || COALESCE(' ' || (SELECT group_concat(tag_plain(t.path), ' ' ORDER BY t.path) FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id WHERE l.source_id = e.id AND tag_plain(t.path) <> t.path), '') || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) FROM entity_aliases a WHERE a.entity_id IN (SELECT l2.target_id FROM edges l2 WHERE l2.kind = 'tagging' AND l2.source_id = e.id)), '') ELSE COALESCE(e.path, '') || COALESCE(' ' || (SELECT tag_plain(e.path) WHERE tag_plain(e.path) <> e.path), '') || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) FROM entity_aliases a WHERE a.entity_id = e.id), '') END) FROM entities e WHERE e.id IN (
    SELECT old.entity_id
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'tagging' AND l.target_id = old.entity_id
  );
END;

-- ============ ④ 删净老对象 ============
DROP VIEW IF EXISTS entities_fts_src;
DROP TRIGGER IF EXISTS notes_ai;
DROP TRIGGER IF EXISTS notes_ad;
DROP TRIGGER IF EXISTS notes_au;
DROP TRIGGER IF EXISTS tag_links_ai;
DROP TRIGGER IF EXISTS tag_links_ad;
DROP TRIGGER IF EXISTS tag_aliases_ai;
DROP TRIGGER IF EXISTS tag_aliases_au;
DROP TRIGGER IF EXISTS tag_aliases_ad;
DROP TABLE IF EXISTS notes_fts;
DROP TABLE IF EXISTS note_links;
DROP TABLE IF EXISTS tag_links;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS tag_aliases;
DROP TABLE IF EXISTS tag_merge_log;
DROP TABLE IF EXISTS notes;

-- ============ ⑤ 整体重建(收口当前数据)============
DELETE FROM entities_fts;
INSERT INTO entities_fts(rowid, name, content, tag_paths)
SELECT e.id, COALESCE(e.name, ''), e.content, trim(CASE WHEN e.kind = 'note' THEN COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path) FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id WHERE l.source_id = e.id), '') || COALESCE(' ' || (SELECT group_concat(tag_plain(t.path), ' ' ORDER BY t.path) FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id WHERE l.source_id = e.id AND tag_plain(t.path) <> t.path), '') || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) FROM entity_aliases a WHERE a.entity_id IN (SELECT l2.target_id FROM edges l2 WHERE l2.kind = 'tagging' AND l2.source_id = e.id)), '') ELSE COALESCE(e.path, '') || COALESCE(' ' || (SELECT tag_plain(e.path) WHERE tag_plain(e.path) <> e.path), '') || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) FROM entity_aliases a WHERE a.entity_id = e.id), '') END) FROM entities e;
