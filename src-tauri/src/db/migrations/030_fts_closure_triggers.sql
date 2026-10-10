-- ============ 1. 闭包刷新触发器 ============
CREATE TRIGGER edges_fts_closure_ai AFTER INSERT ON edges BEGIN
  DELETE FROM entities_fts WHERE rowid IN (
    WITH RECURSIVE
      seed(id) AS (SELECT new.source_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM entities c JOIN sub ON c.parent_id = sub.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN entities p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.source_id FROM edges lb WHERE lb.kind = 'link' AND lb.target_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM entities c JOIN psub ON c.parent_id = psub.id)
    SELECT id FROM sub
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'link'
      AND l.target_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
  INSERT INTO entities_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM entities_fts_src WHERE id IN (
    WITH RECURSIVE
      seed(id) AS (SELECT new.source_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM entities c JOIN sub ON c.parent_id = sub.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN entities p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.source_id FROM edges lb WHERE lb.kind = 'link' AND lb.target_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM entities c JOIN psub ON c.parent_id = psub.id)
    SELECT id FROM sub
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'link'
      AND l.target_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
END;

CREATE TRIGGER edges_fts_closure_ad AFTER DELETE ON edges BEGIN
  DELETE FROM entities_fts WHERE rowid IN (
    WITH RECURSIVE
      seed(id) AS (SELECT old.source_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM entities c JOIN sub ON c.parent_id = sub.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN entities p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.source_id FROM edges lb WHERE lb.kind = 'link' AND lb.target_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM entities c JOIN psub ON c.parent_id = psub.id)
    SELECT id FROM sub
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'link'
      AND l.target_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
  INSERT INTO entities_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM entities_fts_src WHERE id IN (
    WITH RECURSIVE
      seed(id) AS (SELECT old.source_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM entities c JOIN sub ON c.parent_id = sub.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN entities p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.source_id FROM edges lb WHERE lb.kind = 'link' AND lb.target_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM entities c JOIN psub ON c.parent_id = psub.id)
    SELECT id FROM sub
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'link'
      AND l.target_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
END;

CREATE TRIGGER edges_fts_closure_au AFTER UPDATE ON edges BEGIN
  DELETE FROM entities_fts WHERE rowid IN (
    WITH RECURSIVE
      seed(id) AS (SELECT old.source_id UNION SELECT new.source_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM entities c JOIN sub ON c.parent_id = sub.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN entities p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.source_id FROM edges lb WHERE lb.kind = 'link' AND lb.target_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM entities c JOIN psub ON c.parent_id = psub.id)
    SELECT id FROM sub
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'link'
      AND l.target_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
  INSERT INTO entities_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM entities_fts_src WHERE id IN (
    WITH RECURSIVE
      seed(id) AS (SELECT old.source_id UNION SELECT new.source_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM entities c JOIN sub ON c.parent_id = sub.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN entities p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.source_id FROM edges lb WHERE lb.kind = 'link' AND lb.target_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM entities c JOIN psub ON c.parent_id = psub.id)
    SELECT id FROM sub
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'link'
      AND l.target_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
END;

CREATE TRIGGER entities_fts_closure_au AFTER UPDATE OF path ON entities BEGIN
  DELETE FROM entities_fts WHERE rowid IN (
    WITH RECURSIVE
      seed(id) AS (SELECT new.id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM entities c JOIN sub ON c.parent_id = sub.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN entities p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.source_id FROM edges lb WHERE lb.kind = 'link' AND lb.target_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM entities c JOIN psub ON c.parent_id = psub.id)
    SELECT id FROM sub
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'link'
      AND l.target_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
  INSERT INTO entities_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM entities_fts_src WHERE id IN (
    WITH RECURSIVE
      seed(id) AS (SELECT new.id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM entities c JOIN sub ON c.parent_id = sub.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN entities p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.source_id FROM edges lb WHERE lb.kind = 'link' AND lb.target_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM entities c JOIN psub ON c.parent_id = psub.id)
    SELECT id FROM sub
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'link'
      AND l.target_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
END;

CREATE TRIGGER entity_aliases_fts_closure_ai AFTER INSERT ON entity_aliases BEGIN
  DELETE FROM entities_fts WHERE rowid IN (
    WITH RECURSIVE
      seed(id) AS (SELECT new.entity_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM entities c JOIN sub ON c.parent_id = sub.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN entities p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.source_id FROM edges lb WHERE lb.kind = 'link' AND lb.target_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM entities c JOIN psub ON c.parent_id = psub.id)
    SELECT id FROM sub
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'link'
      AND l.target_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
  INSERT INTO entities_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM entities_fts_src WHERE id IN (
    WITH RECURSIVE
      seed(id) AS (SELECT new.entity_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM entities c JOIN sub ON c.parent_id = sub.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN entities p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.source_id FROM edges lb WHERE lb.kind = 'link' AND lb.target_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM entities c JOIN psub ON c.parent_id = psub.id)
    SELECT id FROM sub
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'link'
      AND l.target_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
END;

CREATE TRIGGER entity_aliases_fts_closure_au AFTER UPDATE ON entity_aliases BEGIN
  DELETE FROM entities_fts WHERE rowid IN (
    WITH RECURSIVE
      seed(id) AS (SELECT old.entity_id UNION SELECT new.entity_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM entities c JOIN sub ON c.parent_id = sub.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN entities p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.source_id FROM edges lb WHERE lb.kind = 'link' AND lb.target_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM entities c JOIN psub ON c.parent_id = psub.id)
    SELECT id FROM sub
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'link'
      AND l.target_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
  INSERT INTO entities_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM entities_fts_src WHERE id IN (
    WITH RECURSIVE
      seed(id) AS (SELECT old.entity_id UNION SELECT new.entity_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM entities c JOIN sub ON c.parent_id = sub.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN entities p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.source_id FROM edges lb WHERE lb.kind = 'link' AND lb.target_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM entities c JOIN psub ON c.parent_id = psub.id)
    SELECT id FROM sub
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'link'
      AND l.target_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
END;

CREATE TRIGGER entity_aliases_fts_closure_ad AFTER DELETE ON entity_aliases BEGIN
  DELETE FROM entities_fts WHERE rowid IN (
    WITH RECURSIVE
      seed(id) AS (SELECT old.entity_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM entities c JOIN sub ON c.parent_id = sub.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN entities p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.source_id FROM edges lb WHERE lb.kind = 'link' AND lb.target_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM entities c JOIN psub ON c.parent_id = psub.id)
    SELECT id FROM sub
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'link'
      AND l.target_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
  INSERT INTO entities_fts(rowid, meta, paths)
  SELECT id, meta, paths FROM entities_fts_src WHERE id IN (
    WITH RECURSIVE
      seed(id) AS (SELECT old.entity_id),
      sub(id) AS (SELECT id FROM seed UNION SELECT c.id FROM entities c JOIN sub ON c.parent_id = sub.id),
      up(id) AS (SELECT id FROM seed UNION SELECT p.parent_id FROM up JOIN entities p ON p.id = up.id WHERE p.parent_id IS NOT NULL),
      pre(id) AS (SELECT DISTINCT lb.source_id FROM edges lb WHERE lb.kind = 'link' AND lb.target_id IN (SELECT id FROM up)),
      psub(id) AS (SELECT id FROM pre UNION SELECT c.id FROM entities c JOIN psub ON c.parent_id = psub.id)
    SELECT id FROM sub
    UNION SELECT l.source_id FROM edges l WHERE l.kind = 'link'
      AND l.target_id IN (SELECT id FROM up UNION SELECT id FROM psub)
  );
END;
