-- 031 FTS 之一:点 / 线搜索索引(spec §7.1–7.3;计划 Task 1.3)。**本文件不含聚合文本**。
--
-- 前置钩子 `migration_hooks/point_line.rs`(同一事务、本 SQL 之前跑):
--   ① `prepare_point_line` 已把 `entities` 改名为 `points`、建保留点 `子级`、下架旧 FTS 物件;
--   ② `create_points_fts_src_view` 用 Rust 常量 `POINTS_AGG` 拼出视图 `points_fts_src`
--      (`WHERE NOT_PURE_NAME`,纯名字点整行不进索引)。
-- 因此本文件只做:`points_fts` 表 + 9 个基础触发器(点 / 线 / 别名 的增删改)+ 全库回填。
--
-- 两条替换规则(全仓统一写法):
--   `R(kind='child')` -> `name_id = 0`(树线);`R(kind='link')` -> `(name_id IS NULL OR name_id <> 0)`。
-- `is_cited` 的增量维护留在触发器里(§5.4-①:入非子级线)。闭包的 7 个触发器在
-- `031_point_line_fts_closure.sql`。守卫用例 `point_line_fts_tests::migration_031_has_no_aggregate_sql`
-- 断言本文件不含 `group_concat` / `tag_plain` 的调用文本。视图引用标量函数 `tag_plain`,由 `migrate::apply` 预先注册。

-- ============ 0. 幂等:下架本文件新增的物件(可直接重放)============
DROP TRIGGER IF EXISTS points_ai;
DROP TRIGGER IF EXISTS points_ad;
DROP TRIGGER IF EXISTS points_au;
DROP TRIGGER IF EXISTS lines_ai;
DROP TRIGGER IF EXISTS lines_ad;
DROP TRIGGER IF EXISTS lines_au;
DROP TRIGGER IF EXISTS entity_aliases_ai;
DROP TRIGGER IF EXISTS entity_aliases_au;
DROP TRIGGER IF EXISTS entity_aliases_ad;
DROP TABLE IF EXISTS points_fts;

-- ============ 1. FTS 表(spec §7.1;rowid = points.id)============
CREATE VIRTUAL TABLE points_fts USING fts5(meta, paths, tokenize='trigram');

-- ============ 2. points 增删改 ============
-- points_ai:任何新点整行写出;纯名字点在视图里被过滤,天然无行。
CREATE TRIGGER points_ai AFTER INSERT ON points BEGIN
  INSERT INTO points_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM points_fts_src WHERE id = new.id;
END;

-- points_ad:删点即删索引行(线由 FK CASCADE 处理,不在这里重算)。
CREATE TRIGGER points_ad AFTER DELETE ON points BEGIN
  DELETE FROM points_fts WHERE rowid = old.id;
END;

-- points_au:meta / path 变化整行重写。刷新集合 = 自身 ∪ 子树 ∪ 「非子级线指向该子树的源」。
CREATE TRIGGER points_au AFTER UPDATE OF meta, path ON points BEGIN
  DELETE FROM points_fts WHERE rowid IN (
    WITH RECURSIVE sub(id) AS (
      SELECT new.id
      UNION SELECT c.id FROM points c JOIN sub s ON c.parent_id = s.id
    )
    SELECT id FROM sub
    UNION SELECT l.from_id FROM lines l JOIN sub s ON l.to_id = s.id
     WHERE (l.name_id IS NULL OR l.name_id <> 0)
  );
  INSERT INTO points_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM points_fts_src WHERE id IN (
    WITH RECURSIVE sub(id) AS (
      SELECT new.id
      UNION SELECT c.id FROM points c JOIN sub s ON c.parent_id = s.id
    )
    SELECT id FROM sub
    UNION SELECT l.from_id FROM lines l JOIN sub s ON l.to_id = s.id
     WHERE (l.name_id IS NULL OR l.name_id <> 0)
  );
END;

-- ============ 3. lines 增删改 ============
-- 刷 from/to 两端 + `name_id`(线的出现 / 消失会翻转名字点的 `is_pure_name`,必须连带刷新)。
-- `is_cited` 只由「非子级线」维护(树线不动 is_cited,§5.4-①)。
CREATE TRIGGER lines_ai AFTER INSERT ON lines BEGIN
  DELETE FROM points_fts WHERE rowid IN (SELECT new.from_id UNION SELECT new.to_id UNION SELECT new.name_id);
  INSERT INTO points_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM points_fts_src
  WHERE id IN (SELECT new.from_id UNION SELECT new.to_id UNION SELECT new.name_id);
  UPDATE points SET is_cited = EXISTS (
    SELECT 1 FROM lines x WHERE x.to_id = new.to_id AND (x.name_id IS NULL OR x.name_id <> 0)
  ) WHERE id = new.to_id;
END;

CREATE TRIGGER lines_ad AFTER DELETE ON lines BEGIN
  DELETE FROM points_fts WHERE rowid IN (SELECT old.from_id UNION SELECT old.to_id UNION SELECT old.name_id);
  INSERT INTO points_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM points_fts_src
  WHERE id IN (SELECT old.from_id UNION SELECT old.to_id UNION SELECT old.name_id);
  UPDATE points SET is_cited = EXISTS (
    SELECT 1 FROM lines x WHERE x.to_id = old.to_id AND (x.name_id IS NULL OR x.name_id <> 0)
  ) WHERE id = old.to_id;
END;

-- lines_au:old / new 六端(两端 + 两个 name_id)都刷;两端 `is_cited` 都重算。
CREATE TRIGGER lines_au AFTER UPDATE ON lines BEGIN
  DELETE FROM points_fts WHERE rowid IN (
    SELECT old.from_id UNION SELECT old.to_id UNION SELECT old.name_id
    UNION SELECT new.from_id UNION SELECT new.to_id UNION SELECT new.name_id
  );
  INSERT INTO points_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM points_fts_src WHERE id IN (
    SELECT old.from_id UNION SELECT old.to_id UNION SELECT old.name_id
    UNION SELECT new.from_id UNION SELECT new.to_id UNION SELECT new.name_id
  );
  UPDATE points SET is_cited = EXISTS (
    SELECT 1 FROM lines x WHERE x.to_id = old.to_id AND (x.name_id IS NULL OR x.name_id <> 0)
  ) WHERE id = old.to_id;
  UPDATE points SET is_cited = EXISTS (
    SELECT 1 FROM lines x WHERE x.to_id = new.to_id AND (x.name_id IS NULL OR x.name_id <> 0)
  ) WHERE id = new.to_id;
END;

-- ============ 4. entity_aliases 增删改 ============
-- 别名出现在「点自身」与「非子级线指向它的来源」的聚合串里,两处都刷;改指向时 old/new 两侧都刷。
CREATE TRIGGER entity_aliases_ai AFTER INSERT ON entity_aliases BEGIN
  DELETE FROM points_fts WHERE rowid IN (
    SELECT new.entity_id
    UNION SELECT l.from_id FROM lines l
     WHERE (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id = new.entity_id
  );
  INSERT INTO points_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM points_fts_src WHERE id IN (
    SELECT new.entity_id
    UNION SELECT l.from_id FROM lines l
     WHERE (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id = new.entity_id
  );
END;

CREATE TRIGGER entity_aliases_au AFTER UPDATE ON entity_aliases BEGIN
  DELETE FROM points_fts WHERE rowid IN (
    SELECT old.entity_id UNION SELECT new.entity_id
    UNION SELECT l.from_id FROM lines l
     WHERE (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id IN (old.entity_id, new.entity_id)
  );
  INSERT INTO points_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM points_fts_src WHERE id IN (
    SELECT old.entity_id UNION SELECT new.entity_id
    UNION SELECT l.from_id FROM lines l
     WHERE (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id IN (old.entity_id, new.entity_id)
  );
END;

CREATE TRIGGER entity_aliases_ad AFTER DELETE ON entity_aliases BEGIN
  DELETE FROM points_fts WHERE rowid IN (
    SELECT old.entity_id
    UNION SELECT l.from_id FROM lines l
     WHERE (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id = old.entity_id
  );
  INSERT INTO points_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM points_fts_src WHERE id IN (
    SELECT old.entity_id
    UNION SELECT l.from_id FROM lines l
     WHERE (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id = old.entity_id
  );
END;

-- ============ 5. 全库回填(与维护命令同一视图真源、同一事务;幂等)============
DELETE FROM points_fts;
INSERT INTO points_fts(rowid, meta, paths)
SELECT id, meta, paths FROM points_fts_src;
