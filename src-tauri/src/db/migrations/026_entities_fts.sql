-- 026: 统一实体第三步 —— 建 `entities_fts(name, content, tag_paths)`(覆盖笔记与标签两种实体)、
-- 9 个新触发器(entities/edges/entity_aliases 各增删改,spec §4.3)、并把 `entities` 整体重建一次。
--
-- 阶段 3 起 `entities_fts` 是搜索目标,但 `notes_fts` 与老 8 个触发器**原样保留**(计划 T4.7 才下架):
-- 阶段 1–3 老表仍是应用真源,未迁移的搜索读方继续读 `notes_fts`,再由写路径双写维护 ——
-- FTS5 虚拟表之间不宜用触发器互搬(spec §6.5),故这里不建 `entities_fts -> notes_fts` 镜像触发器。
--
-- 聚合口径的唯一 SQL 实现放在视图 `entities_fts_src`(trigger 与重建都从它取),文本与 Rust 真源
-- [`crate::db::repos::entities::fts::ENTITIES_AGG`] 逐段一致(守卫用例 entities_fts_migration_tests
-- ::agg_segments_appear_in_026_text 按 `COALESCE(` 切段比对)。视图引用标量函数 `tag_plain`,
-- 由 `migrate::apply` / `run` 预先注册(直接 execute_batch 本文件会报 no such function)。
--
-- `entity_aliases` 在 026 才存在:先建表,再从老 `tag_aliases` 按标签 id 偏移翻译回填;
-- 老 `tag_aliases` 保留到阶段 4(D7 改名在 027 收口)。标签 id 偏移 `TAG_ID_OFFSET` = 1000000000
-- (spec §12 D1;字面量由 repos/entities/mod.rs 的常量守卫钉住)。
--
-- 可重放:表/视图/触发器一律 IF NOT EXISTS / DROP IF EXISTS + 重建;回填 INSERT OR IGNORE;
-- 重建 DELETE + INSERT 幂等。SQL 与 user_version 由 `migrate::apply` 放在同一事务。

-- ============ FTS 表(spec §4.1;普通表非 external content,与 003 同款)============
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(name, content, tag_paths, tokenize='trigram');

-- ============ 别名表(阶段 4 前与 tag_aliases 并存;FK 随实体删除级联)============
CREATE TABLE IF NOT EXISTS entity_aliases (
  alias     TEXT PRIMARY KEY,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE
);
INSERT OR IGNORE INTO entity_aliases(alias, entity_id)
SELECT a.alias, a.tag_id + 1000000000
FROM tag_aliases a
WHERE EXISTS (SELECT 1 FROM entities e WHERE e.id = a.tag_id + 1000000000);

-- ============ 聚合真源视图(唯一一处 SQL 表达式;触发器/重建都读它)============
CREATE VIEW IF NOT EXISTS entities_fts_src(id, name, content, tag_paths) AS
SELECT e.id, COALESCE(e.name, ''), e.content, trim(CASE WHEN e.kind = 'note' THEN COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path) FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id WHERE l.source_id = e.id), '') || COALESCE(' ' || (SELECT group_concat(tag_plain(t.path), ' ' ORDER BY t.path) FROM entities t JOIN edges l ON l.kind = 'tagging' AND l.target_id = t.id WHERE l.source_id = e.id AND tag_plain(t.path) <> t.path), '') || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) FROM entity_aliases a WHERE a.entity_id IN (SELECT l2.target_id FROM edges l2 WHERE l2.kind = 'tagging' AND l2.source_id = e.id)), '') ELSE COALESCE(e.path, '') || COALESCE(' ' || (SELECT tag_plain(e.path) WHERE tag_plain(e.path) <> e.path), '') || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias) FROM entity_aliases a WHERE a.entity_id = e.id), '') END)
FROM entities e;

-- ============ ① entities 增删改 ============
-- entities_ai:任何新实体(笔记或标签)整行写出
DROP TRIGGER IF EXISTS entities_ai;
CREATE TRIGGER entities_ai AFTER INSERT ON entities BEGIN
  INSERT INTO entities_fts(rowid, name, content, tag_paths)
  SELECT id, name, content, tag_paths FROM entities_fts_src WHERE id = new.id;
END;

-- entities_ad:删实体即删索引行(边由 FK CASCADE 处理,不在这里重算)
DROP TRIGGER IF EXISTS entities_ad;
CREATE TRIGGER entities_ad AFTER DELETE ON entities BEGIN
  DELETE FROM entities_fts WHERE rowid = old.id;
END;

-- entities_au:content/name/path 变化整行重写。标签的 path 变化会改**它自己与全部子孙**的
-- tag_paths,以及链到子树里任一标签的笔记的聚合串,故刷新集合 = 子树标签 ∪ 这些标签名下笔记。
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
  SELECT id, name, content, tag_paths FROM entities_fts_src WHERE id IN (
    WITH RECURSIVE sub(id) AS (
      SELECT new.id
      UNION SELECT g.target_id FROM edges g JOIN sub ON g.source_id = sub.id AND g.kind = 'child'
    )
    SELECT id FROM sub
    UNION SELECT l.source_id FROM edges l JOIN sub ON l.target_id = sub.id AND l.kind = 'tagging'
  );
END;

-- ============ ② edges 增删改 ============
-- tagging 改来源笔记的 tag_paths;child/relation 只改两端标签实体的结构性缓存(重算值通常不变)。
DROP TRIGGER IF EXISTS edges_ai;
CREATE TRIGGER edges_ai AFTER INSERT ON edges BEGIN
  DELETE FROM entities_fts WHERE rowid IN (
    SELECT new.source_id WHERE new.kind = 'tagging'
    UNION SELECT new.source_id WHERE new.kind IN ('child', 'relation')
    UNION SELECT new.target_id WHERE new.kind IN ('child', 'relation')
  );
  INSERT INTO entities_fts(rowid, name, content, tag_paths)
  SELECT id, name, content, tag_paths FROM entities_fts_src WHERE id IN (
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
  SELECT id, name, content, tag_paths FROM entities_fts_src WHERE id IN (
    SELECT old.source_id WHERE old.kind = 'tagging'
    UNION SELECT old.source_id WHERE old.kind IN ('child', 'relation')
    UNION SELECT old.target_id WHERE old.kind IN ('child', 'relation')
  );
END;

-- edges_au:今天 tag_links 故意没有 au(笔记链接行禁止 UPDATE);统一后边表允许改 remark,
-- 故必须补 au,且 old/new 两侧都刷(tagging 换目标 / child 换父子 / relation 改 remark)。
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
  SELECT id, name, content, tag_paths FROM entities_fts_src WHERE id IN (
    SELECT old.source_id WHERE old.kind = 'tagging'
    UNION SELECT old.source_id WHERE old.kind IN ('child', 'relation')
    UNION SELECT old.target_id WHERE old.kind IN ('child', 'relation')
    UNION SELECT new.source_id WHERE new.kind = 'tagging'
    UNION SELECT new.source_id WHERE new.kind IN ('child', 'relation')
    UNION SELECT new.target_id WHERE new.kind IN ('child', 'relation')
  );
END;

-- ============ ③ entity_aliases 增删改 ============
-- 别名只出现在「该标签自身」与「直接链该标签的笔记」的聚合串里(与今天 TAGS_AGG 口径一致),
-- 故刷新集合 = 实体自身 ∪ tagging 指向它的笔记;改指向时 old/new 两侧都要刷。
DROP TRIGGER IF EXISTS entity_aliases_ai;
CREATE TRIGGER entity_aliases_ai AFTER INSERT ON entity_aliases BEGIN
  DELETE FROM entities_fts WHERE rowid IN (
    SELECT new.entity_id
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'tagging' AND l.target_id = new.entity_id
  );
  INSERT INTO entities_fts(rowid, name, content, tag_paths)
  SELECT id, name, content, tag_paths FROM entities_fts_src WHERE id IN (
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
  SELECT id, name, content, tag_paths FROM entities_fts_src WHERE id IN (
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
  SELECT id, name, content, tag_paths FROM entities_fts_src WHERE id IN (
    SELECT old.entity_id
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'tagging' AND l.target_id = old.entity_id
  );
END;

-- ============ 整体重建(与维护命令同一视图真源、同一事务;幂等)============
DELETE FROM entities_fts;
INSERT INTO entities_fts(rowid, name, content, tag_paths)
SELECT id, name, content, tag_paths FROM entities_fts_src;
