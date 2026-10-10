-- 031 FTS 之二:闭包刷新触发器(030 的 7 个按点/线口径逐条改写;计划 Task 1.3 / spec §7.3 #10-#16)。
-- **本文件不含聚合文本**。视图 `points_fts_src` 由前置钩子从 Rust 常量 `POINTS_AGG` 拼出。
--
-- 刷新集合(与 030 同形,只换表名与「非子级线」判据):
--   对节点 seed,刷新 = subtree(seed)
--     ∪ linkSources(ancestorsOrSelf(seed) ∪ subtree({a : a --非子级线--> B, B ∈ ancestorsOrSelf(seed)}))
-- `sub` / `up` / `psub` 的递归仍沿 `parent_id`(v30 即如此),不改形状。
-- `lines_fts_closure_*` 的 seed 额外含 `name_id`:线的出现 / 消失会翻转名字点的 `is_pure_name`。
-- 必须 `DELETE` + 普通 `INSERT`(不能 `INSERT OR REPLACE`:外层 `INSERT OR IGNORE` 会继承冲突策略
-- 静默吞掉 FTS5 的 REPLACE,030 实测)。

-- ============ 0. 幂等:下架本文件新增的触发器 ============
DROP TRIGGER IF EXISTS lines_fts_closure_ai;
DROP TRIGGER IF EXISTS lines_fts_closure_ad;
DROP TRIGGER IF EXISTS lines_fts_closure_au;
DROP TRIGGER IF EXISTS points_fts_closure_au;
DROP TRIGGER IF EXISTS entity_aliases_fts_closure_ai;
DROP TRIGGER IF EXISTS entity_aliases_fts_closure_au;
DROP TRIGGER IF EXISTS entity_aliases_fts_closure_ad;

-- ============ 1. lines 闭包(seed = from_id ∪ name_id)============
CREATE TRIGGER lines_fts_closure_ai AFTER INSERT ON lines BEGIN
  DELETE FROM points_fts WHERE rowid IN (
    WITH RECURSIVE
      seed(id) AS (SELECT new.from_id UNION SELECT new.name_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM points c JOIN sub s ON c.parent_id = s.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN points p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.from_id FROM lines lb WHERE (lb.name_id IS NULL OR lb.name_id <> 0) AND lb.to_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM points c JOIN psub s ON c.parent_id = s.id)
    SELECT id FROM sub UNION SELECT l.from_id FROM lines l
     WHERE (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
  INSERT INTO points_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM points_fts_src WHERE id IN (
    WITH RECURSIVE
      seed(id) AS (SELECT new.from_id UNION SELECT new.name_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM points c JOIN sub s ON c.parent_id = s.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN points p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.from_id FROM lines lb WHERE (lb.name_id IS NULL OR lb.name_id <> 0) AND lb.to_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM points c JOIN psub s ON c.parent_id = s.id)
    SELECT id FROM sub UNION SELECT l.from_id FROM lines l
     WHERE (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
END;

CREATE TRIGGER lines_fts_closure_ad AFTER DELETE ON lines BEGIN
  DELETE FROM points_fts WHERE rowid IN (
    WITH RECURSIVE
      seed(id) AS (SELECT old.from_id UNION SELECT old.name_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM points c JOIN sub s ON c.parent_id = s.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN points p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.from_id FROM lines lb WHERE (lb.name_id IS NULL OR lb.name_id <> 0) AND lb.to_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM points c JOIN psub s ON c.parent_id = s.id)
    SELECT id FROM sub UNION SELECT l.from_id FROM lines l
     WHERE (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
  INSERT INTO points_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM points_fts_src WHERE id IN (
    WITH RECURSIVE
      seed(id) AS (SELECT old.from_id UNION SELECT old.name_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM points c JOIN sub s ON c.parent_id = s.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN points p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.from_id FROM lines lb WHERE (lb.name_id IS NULL OR lb.name_id <> 0) AND lb.to_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM points c JOIN psub s ON c.parent_id = s.id)
    SELECT id FROM sub UNION SELECT l.from_id FROM lines l
     WHERE (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
END;

CREATE TRIGGER lines_fts_closure_au AFTER UPDATE ON lines BEGIN
  DELETE FROM points_fts WHERE rowid IN (
    WITH RECURSIVE
      seed(id) AS (SELECT old.from_id UNION SELECT new.from_id UNION SELECT old.name_id UNION SELECT new.name_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM points c JOIN sub s ON c.parent_id = s.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN points p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.from_id FROM lines lb WHERE (lb.name_id IS NULL OR lb.name_id <> 0) AND lb.to_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM points c JOIN psub s ON c.parent_id = s.id)
    SELECT id FROM sub UNION SELECT l.from_id FROM lines l
     WHERE (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
  INSERT INTO points_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM points_fts_src WHERE id IN (
    WITH RECURSIVE
      seed(id) AS (SELECT old.from_id UNION SELECT new.from_id UNION SELECT old.name_id UNION SELECT new.name_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM points c JOIN sub s ON c.parent_id = s.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN points p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.from_id FROM lines lb WHERE (lb.name_id IS NULL OR lb.name_id <> 0) AND lb.to_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM points c JOIN psub s ON c.parent_id = s.id)
    SELECT id FROM sub UNION SELECT l.from_id FROM lines l
     WHERE (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
END;

-- ============ 2. points 路径闭包(seed = new.id)============
CREATE TRIGGER points_fts_closure_au AFTER UPDATE OF path ON points BEGIN
  DELETE FROM points_fts WHERE rowid IN (
    WITH RECURSIVE
      seed(id) AS (SELECT new.id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM points c JOIN sub s ON c.parent_id = s.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN points p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.from_id FROM lines lb WHERE (lb.name_id IS NULL OR lb.name_id <> 0) AND lb.to_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM points c JOIN psub s ON c.parent_id = s.id)
    SELECT id FROM sub UNION SELECT l.from_id FROM lines l
     WHERE (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
  INSERT INTO points_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM points_fts_src WHERE id IN (
    WITH RECURSIVE
      seed(id) AS (SELECT new.id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM points c JOIN sub s ON c.parent_id = s.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN points p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.from_id FROM lines lb WHERE (lb.name_id IS NULL OR lb.name_id <> 0) AND lb.to_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM points c JOIN psub s ON c.parent_id = s.id)
    SELECT id FROM sub UNION SELECT l.from_id FROM lines l
     WHERE (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
END;

-- ============ 3. entity_aliases 闭包(seed = entity_id)============
CREATE TRIGGER entity_aliases_fts_closure_ai AFTER INSERT ON entity_aliases BEGIN
  DELETE FROM points_fts WHERE rowid IN (
    WITH RECURSIVE
      seed(id) AS (SELECT new.entity_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM points c JOIN sub s ON c.parent_id = s.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN points p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.from_id FROM lines lb WHERE (lb.name_id IS NULL OR lb.name_id <> 0) AND lb.to_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM points c JOIN psub s ON c.parent_id = s.id)
    SELECT id FROM sub UNION SELECT l.from_id FROM lines l
     WHERE (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
  INSERT INTO points_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM points_fts_src WHERE id IN (
    WITH RECURSIVE
      seed(id) AS (SELECT new.entity_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM points c JOIN sub s ON c.parent_id = s.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN points p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.from_id FROM lines lb WHERE (lb.name_id IS NULL OR lb.name_id <> 0) AND lb.to_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM points c JOIN psub s ON c.parent_id = s.id)
    SELECT id FROM sub UNION SELECT l.from_id FROM lines l
     WHERE (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
END;

CREATE TRIGGER entity_aliases_fts_closure_au AFTER UPDATE ON entity_aliases BEGIN
  DELETE FROM points_fts WHERE rowid IN (
    WITH RECURSIVE
      seed(id) AS (SELECT old.entity_id UNION SELECT new.entity_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM points c JOIN sub s ON c.parent_id = s.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN points p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.from_id FROM lines lb WHERE (lb.name_id IS NULL OR lb.name_id <> 0) AND lb.to_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM points c JOIN psub s ON c.parent_id = s.id)
    SELECT id FROM sub UNION SELECT l.from_id FROM lines l
     WHERE (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
  INSERT INTO points_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM points_fts_src WHERE id IN (
    WITH RECURSIVE
      seed(id) AS (SELECT old.entity_id UNION SELECT new.entity_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM points c JOIN sub s ON c.parent_id = s.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN points p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.from_id FROM lines lb WHERE (lb.name_id IS NULL OR lb.name_id <> 0) AND lb.to_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM points c JOIN psub s ON c.parent_id = s.id)
    SELECT id FROM sub UNION SELECT l.from_id FROM lines l
     WHERE (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
END;

CREATE TRIGGER entity_aliases_fts_closure_ad AFTER DELETE ON entity_aliases BEGIN
  DELETE FROM points_fts WHERE rowid IN (
    WITH RECURSIVE
      seed(id) AS (SELECT old.entity_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM points c JOIN sub s ON c.parent_id = s.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN points p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.from_id FROM lines lb WHERE (lb.name_id IS NULL OR lb.name_id <> 0) AND lb.to_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM points c JOIN psub s ON c.parent_id = s.id)
    SELECT id FROM sub UNION SELECT l.from_id FROM lines l
     WHERE (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
  INSERT INTO points_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM points_fts_src WHERE id IN (
    WITH RECURSIVE
      seed(id) AS (SELECT old.entity_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM points c JOIN sub s ON c.parent_id = s.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN points p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.from_id FROM lines lb WHERE (lb.name_id IS NULL OR lb.name_id <> 0) AND lb.to_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM points c JOIN psub s ON c.parent_id = s.id)
    SELECT id FROM sub UNION SELECT l.from_id FROM lines l
     WHERE (l.name_id IS NULL OR l.name_id <> 0) AND l.to_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
END;
