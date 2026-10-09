-- 029: 统一元数据 FTS 收口 —— 重建 `entities_fts(meta, paths)` + 9 个触发器 + 全库回填
-- (spec §6.1–6.4,计划 Task 1.3)。
--
-- 028 已把 026/027 的过渡物件删净(表/视图/9 个旧触发器),本迁移建统一后的终态:
--   ① `entities_fts` 两列 `meta`(标签名 / 笔记正文)与 `paths`(聚合路径段,口径见 spec §6.2);
--   ② 9 个触发器(名字与 026 相同),触发集合按 spec §6.3:link 边刷两端、child 边只刷两端
--      (不重算 `paths`,P0-6:path 缓存由写路径同事务维护)、实体 `meta`/`path` 变化刷子树与引用源;
--   ③ 全库回填。
--
-- **聚合表达式不写在本文件**:唯一真源是 Rust 常量
-- [`crate::db::repos::entities::fts::ENTITIES_AGG`],由 v29 的事务内前置钩子
-- (`migration_hooks::create_entities_fts_src_view`)拼成视图 `entities_fts_src(id, meta, paths)`;
-- 触发器与回填都只引用该视图。守卫用例 `entities_fts_migration_tests::migration_029_has_no_aggregate_sql`
-- 断言本文件不含聚合函数的调用文本。
--
-- 视图与触发器都会调用标量函数 `tag_plain`,由 `migrate::apply` 预先注册(直接 execute_batch
-- 本文件会报 no such function)。SQL 与 user_version 由 `migrate::apply` 放在同一事务。

-- ============ 0. 清 028 已删的残留(幂等兜底,可直接重放)============
DROP TRIGGER IF EXISTS entities_ai;
DROP TRIGGER IF EXISTS entities_ad;
DROP TRIGGER IF EXISTS entities_au;
DROP TRIGGER IF EXISTS edges_ai;
DROP TRIGGER IF EXISTS edges_ad;
DROP TRIGGER IF EXISTS edges_au;
DROP TRIGGER IF EXISTS entity_aliases_ai;
DROP TRIGGER IF EXISTS entity_aliases_au;
DROP TRIGGER IF EXISTS entity_aliases_ad;
DROP TABLE IF EXISTS entities_fts;

-- ============ 1. FTS 表(spec §6.1;普通表非 external content,rowid = entities.id)============
CREATE VIRTUAL TABLE entities_fts USING fts5(meta, paths, tokenize='trigram');

-- ============ 2. ① entities 增删改 ============
-- entities_ai:任何新实体整行写出(它的边/别名随后插入时由对应触发器补刷)
CREATE TRIGGER entities_ai AFTER INSERT ON entities BEGIN
  INSERT INTO entities_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM entities_fts_src WHERE id = new.id;
END;

-- entities_ad:删实体即删索引行(边由 FK CASCADE 处理,不在这里重算)
CREATE TRIGGER entities_ad AFTER DELETE ON entities BEGIN
  DELETE FROM entities_fts WHERE rowid = old.id;
END;

-- entities_au:meta/path 变化整行重写。刷新集合 = 自身 ∪ child 子树 ∪ 「link 指向该子树的源」
-- (spec §6.3 表 #3;旧口径的 `kind='tag'` 过滤随统一实体去掉)。
CREATE TRIGGER entities_au AFTER UPDATE OF meta, path ON entities BEGIN
  DELETE FROM entities_fts WHERE rowid IN (
    WITH RECURSIVE sub(id) AS (
      SELECT new.id
      UNION SELECT g.target_id FROM edges g JOIN sub ON g.source_id = sub.id AND g.kind = 'child'
    )
    SELECT id FROM sub
    UNION SELECT l.source_id FROM edges l JOIN sub ON l.target_id = sub.id AND l.kind = 'link'
  );
  INSERT INTO entities_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM entities_fts_src WHERE id IN (
    WITH RECURSIVE sub(id) AS (
      SELECT new.id
      UNION SELECT g.target_id FROM edges g JOIN sub ON g.source_id = sub.id AND g.kind = 'child'
    )
    SELECT id FROM sub
    UNION SELECT l.source_id FROM edges l JOIN sub ON l.target_id = sub.id AND l.kind = 'link'
  );
END;

-- ============ 3. ② edges 增删改 ============
-- 两端都刷(link:来源重算引用段、目标重算自身段;child:仅两端、paths 不变 —— P0-6)。
-- 每条边变化后重算 target 的 `is_cited`(有入 link 边 = 1,spec §3.1,幂等增量)。
CREATE TRIGGER edges_ai AFTER INSERT ON edges BEGIN
  DELETE FROM entities_fts WHERE rowid IN (SELECT new.source_id UNION SELECT new.target_id);
  INSERT INTO entities_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM entities_fts_src
  WHERE id IN (SELECT new.source_id UNION SELECT new.target_id);
  UPDATE entities SET is_cited = EXISTS (
    SELECT 1 FROM edges x WHERE x.target_id = new.target_id AND x.kind = 'link'
  ) WHERE id = new.target_id;
END;

CREATE TRIGGER edges_ad AFTER DELETE ON edges BEGIN
  DELETE FROM entities_fts WHERE rowid IN (SELECT old.source_id UNION SELECT old.target_id);
  INSERT INTO entities_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM entities_fts_src
  WHERE id IN (SELECT old.source_id UNION SELECT old.target_id);
  UPDATE entities SET is_cited = EXISTS (
    SELECT 1 FROM edges x WHERE x.target_id = old.target_id AND x.kind = 'link'
  ) WHERE id = old.target_id;
END;

-- edges_au:old/new 两侧都刷(tagging 换目标 / child 换父子 / 改 remark);两端 `is_cited` 都重算。
CREATE TRIGGER edges_au AFTER UPDATE ON edges BEGIN
  DELETE FROM entities_fts WHERE rowid IN (
    SELECT old.source_id UNION SELECT old.target_id
    UNION SELECT new.source_id UNION SELECT new.target_id
  );
  INSERT INTO entities_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM entities_fts_src WHERE id IN (
    SELECT old.source_id UNION SELECT old.target_id
    UNION SELECT new.source_id UNION SELECT new.target_id
  );
  UPDATE entities SET is_cited = EXISTS (
    SELECT 1 FROM edges x WHERE x.target_id = old.target_id AND x.kind = 'link'
  ) WHERE id = old.target_id;
  UPDATE entities SET is_cited = EXISTS (
    SELECT 1 FROM edges x WHERE x.target_id = new.target_id AND x.kind = 'link'
  ) WHERE id = new.target_id;
END;

-- ============ 4. ③ entity_aliases 增删改 ============
-- 别名出现在「实体自身」与「link 指向它的来源」的聚合串里,两处都刷;改指向时 old/new 两侧都刷。
CREATE TRIGGER entity_aliases_ai AFTER INSERT ON entity_aliases BEGIN
  DELETE FROM entities_fts WHERE rowid IN (
    SELECT new.entity_id
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'link' AND l.target_id = new.entity_id
  );
  INSERT INTO entities_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM entities_fts_src WHERE id IN (
    SELECT new.entity_id
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'link' AND l.target_id = new.entity_id
  );
END;

CREATE TRIGGER entity_aliases_au AFTER UPDATE ON entity_aliases BEGIN
  DELETE FROM entities_fts WHERE rowid IN (
    SELECT old.entity_id UNION SELECT new.entity_id
    UNION SELECT l.source_id FROM edges l
     WHERE l.kind = 'link' AND l.target_id IN (old.entity_id, new.entity_id)
  );
  INSERT INTO entities_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM entities_fts_src WHERE id IN (
    SELECT old.entity_id UNION SELECT new.entity_id
    UNION SELECT l.source_id FROM edges l
     WHERE l.kind = 'link' AND l.target_id IN (old.entity_id, new.entity_id)
  );
END;

CREATE TRIGGER entity_aliases_ad AFTER DELETE ON entity_aliases BEGIN
  DELETE FROM entities_fts WHERE rowid IN (
    SELECT old.entity_id
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'link' AND l.target_id = old.entity_id
  );
  INSERT INTO entities_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM entities_fts_src WHERE id IN (
    SELECT old.entity_id
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'link' AND l.target_id = old.entity_id
  );
END;

-- ============ 5. 全库回填(与维护命令同一视图真源、同一事务;幂等)============
DELETE FROM entities_fts;
INSERT INTO entities_fts(rowid, meta, paths)
SELECT id, meta, paths FROM entities_fts_src;
