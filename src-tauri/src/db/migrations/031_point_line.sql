-- 031: 点 / 线表重建(spec §3 / §4;计划 Task 1.2)。**不含 FTS 与触发器**(Task 1.3)。
--
-- 前置钩子 `migration_hooks/point_line.rs::prepare_point_line`(同一事务、本 SQL 之前跑):
--   ① `ALTER TABLE entities RENAME TO points`(列集合一字不差,旧 id 原样;FK / 视图 / 触发器
--      里的 `entities` 引用随改名改写,`entity_aliases` 无需重建);
--   ② 补齐保留名字点 `子级`(id = 0,存在即复用);
--   ③ 建临时边源 `_point_line_edges`(新库 = `edges` 上的视图;重放 = 同列空表)。
-- 因此本文件只做:建关系名点 + 搬线 + 建索引 + 写 settings + 下架旧边与旧 FTS 物件。
--
-- 幂等与崩溃重放:`migrate::apply` 把本 SQL 与 `user_version` 同事务提交,失败整体回滚;
-- 重复执行时 `_point_line_edges` 为空 → 关系名点与线都不再新增,建表 / 建索引全部 `IF NOT EXISTS`。

-- ============ 1. 关系名点(spec §4.2:同类名只建一个点;created_at 取该名字最早一条边) ============
DROP TABLE IF EXISTS _line_names;
CREATE TEMP TABLE _line_names(remark TEXT PRIMARY KEY, id INTEGER);
INSERT INTO _line_names(id, remark)
SELECT (SELECT COALESCE(MAX(id), 0) FROM points) + ROW_NUMBER() OVER (ORDER BY remark),
       remark
FROM (SELECT DISTINCT remark FROM _point_line_edges WHERE kind = 'link' AND remark <> '');
INSERT INTO points(id, meta, is_cited, created_at, color, parent_id, path, depth, sort_order)
SELECT n.id, n.remark, 0,
       (SELECT MIN(e.created_at) FROM _point_line_edges e
         WHERE e.kind = 'link' AND e.remark = n.remark),
       NULL, NULL, NULL, NULL, 0
FROM _line_names n;

-- ============ 2. 线表(spec §3.2)+ 搬线(§4.2 四种旧组合) ============
-- 不做自指过滤:真库自指 0 条,若夹具造出自指边,让 `CHECK (from_id <> to_id)` 使整批回滚。
CREATE TABLE IF NOT EXISTS lines (
  id         INTEGER PRIMARY KEY,
  from_id    INTEGER NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  to_id      INTEGER NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  name_id    INTEGER REFERENCES points(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  CHECK (from_id <> to_id)
);
INSERT INTO lines(id, from_id, to_id, name_id, created_at)
SELECT e.id, e.source_id, e.target_id,
       CASE
         WHEN e.kind = 'child' THEN 0
         WHEN e.kind = 'link' AND e.remark = '' THEN NULL
         ELSE (SELECT n.id FROM _line_names n WHERE n.remark = e.remark)
       END,
       e.created_at
FROM _point_line_edges e;

-- ============ 3. 索引(spec §3.1 / §3.2) ============
DROP INDEX IF EXISTS idx_entities_path;
DROP INDEX IF EXISTS idx_edges_source;
DROP INDEX IF EXISTS idx_edges_target;
CREATE INDEX IF NOT EXISTS idx_points_path ON points(path) WHERE path IS NOT NULL;
-- 表达式唯一索引必须独立建(SQLite 不允许把含表达式的 UNIQUE 写进表约束,spec §17-E);
-- 哨兵用 -1(保留点 id = 0,计划 P0-1),把「无名字」与「某个名字点」区分开。
CREATE UNIQUE INDEX IF NOT EXISTS idx_lines_uniq ON lines(from_id, to_id, COALESCE(name_id, -1));
CREATE INDEX IF NOT EXISTS idx_lines_to ON lines(to_id, name_id);
CREATE INDEX IF NOT EXISTS idx_lines_name ON lines(name_id);

-- ============ 4. settings:保留点记录(spec §3.3;存在即不覆盖) ============
INSERT INTO settings(key, value) VALUES('tree_line_name_id', '0')
  ON CONFLICT(key) DO NOTHING;

-- ============ 5. 下架旧触发器 / 旧 FTS / 旧表 / 临时物件(全部幂等) ============
DROP TRIGGER IF EXISTS entities_ai;
DROP TRIGGER IF EXISTS entities_ad;
DROP TRIGGER IF EXISTS entities_au;
DROP TRIGGER IF EXISTS entities_fts_closure_au;
DROP TRIGGER IF EXISTS edges_ai;
DROP TRIGGER IF EXISTS edges_ad;
DROP TRIGGER IF EXISTS edges_au;
DROP TRIGGER IF EXISTS edges_fts_closure_ai;
DROP TRIGGER IF EXISTS edges_fts_closure_ad;
DROP TRIGGER IF EXISTS edges_fts_closure_au;
DROP TRIGGER IF EXISTS entity_aliases_ai;
DROP TRIGGER IF EXISTS entity_aliases_au;
DROP TRIGGER IF EXISTS entity_aliases_ad;
DROP TRIGGER IF EXISTS entity_aliases_fts_closure_ai;
DROP TRIGGER IF EXISTS entity_aliases_fts_closure_au;
DROP TRIGGER IF EXISTS entity_aliases_fts_closure_ad;
DROP VIEW IF EXISTS entities_fts_src;
DROP TABLE IF EXISTS entities_fts;
DROP TABLE IF EXISTS _point_line_edges;
DROP TABLE IF EXISTS edges;
DROP TABLE IF EXISTS entities;
DROP TABLE IF EXISTS _line_names;
