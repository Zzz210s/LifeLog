-- 028: 统一元数据阶段 1 —— 表与边重建(spec §2 / §7.1 步 1/3/4/6/7/8/9/10)。
--
-- 同一事务内完成(由 `migrate::apply` 保证,SQL 与 user_version 一起提交/回滚):
--   ① 建新表 `entities`(去 `kind`/`name`,加 `meta`/`is_cited`,id 全库重发)与
--      `edges`(老四种 kind 收成 `child`/`link`,id 重排);② 两端 id 按 `_id_map` 改写;
--   ③ 改写 `entity_aliases.entity_id` 与 `entity_merge_log`(加 `meta_snapshot` 列);
--   ④ 删旧表 / 旧触发器 / 旧索引与 FTS 过渡物件;⑤ 建新索引。
--
-- id 映射与 settings 改写由**事务内前置钩子**产出(`migration_hooks/unify_meta.rs` 的
-- `build_id_map` / `rewrite_settings_ids` / `ensure_default_filter`,经 `migration_hooks::run_pre_hooks`
-- 在迁移 SQL 之前跑):本文件的 SQL 从临时表 `_id_map` 取新 id。
--
-- 028 不引用老表(`notes`/`tags`/`tag_links`/`note_links`/`notes_fts` 已在 027 下架);FTS 表
-- `entities_fts` 由本文件删净、Task 1.3 在同一文件追加新 DDL 与 9 个触发器(新列 `meta,paths`)。
--
-- 外键:重建期间 `edges_new` / `entity_aliases_new` 的 FK 仍指向**旧** `entities`,而填入的是
-- 映射后的新 id,故 028 必须在外键关闭下跑(`migrate::FK_OFF_VERSIONS` 含 28);迁移结束由
-- 对账的 `foreign_key_check` 兜底。
--
-- 可崩溃重放:`apply` 把整批 SQL 放进一个事务,中途失败全部回滚(版本号不推进),下次启动从
-- 头重跑;因此新表用 `IF NOT EXISTS`、`_id_map` 用 `DROP ... IF EXISTS`,重复执行不叠加。

-- ============ 0. 清 026/027 遗留的 FTS 过渡物件(spec §7.1 步 9)============
DROP VIEW IF EXISTS entities_fts_src;
DROP TABLE IF EXISTS entities_fts;
DROP TRIGGER IF EXISTS entities_ai;
DROP TRIGGER IF EXISTS entities_ad;
DROP TRIGGER IF EXISTS entities_au;
DROP TRIGGER IF EXISTS edges_ai;
DROP TRIGGER IF EXISTS edges_ad;
DROP TRIGGER IF EXISTS edges_au;
DROP TRIGGER IF EXISTS entity_aliases_ai;
DROP TRIGGER IF EXISTS entity_aliases_au;
DROP TRIGGER IF EXISTS entity_aliases_ad;

-- ============ 1. 新表(spec §2.1 / §2.3)============
-- `entities.is_cited` 是派生缓存:有入 `link` 边(spec §3.1,`child` 是结构边不算引用)。
-- `edges.kind` 只剩 `child`/`link`;`UNIQUE(source_id,kind,target_id)` 同向同类边天然去重。
CREATE TABLE IF NOT EXISTS entities_new (
  id         INTEGER PRIMARY KEY,
  meta       TEXT NOT NULL DEFAULT '',
  is_cited   INTEGER NOT NULL DEFAULT 0 CHECK (is_cited IN (0, 1)),
  created_at TEXT NOT NULL,
  color      TEXT,
  parent_id  INTEGER,
  path       TEXT,
  depth      INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS edges_new (
  id         INTEGER PRIMARY KEY,
  source_id  INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_id  INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('child', 'link')),
  remark     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (source_id, kind, target_id)
);
CREATE TABLE IF NOT EXISTS entity_aliases_new (
  alias     TEXT PRIMARY KEY,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE
);

-- ============ 2. entities_new 填数(步 3)============
-- `meta` = 标签取 `name`、笔记取 `content`(spec §2.2);`is_cited` = 有入 `link` 边 —— 老三种
-- 引用类边(`tagging`/`relation`/`link`)迁后都成 `link`,`child` 不计。`parent_id` 按映射改写,
-- `path`/`depth`/`sort_order` 原样搬(标签有值、笔记 NULL);未映射的父指针保持 NULL。
INSERT INTO entities_new(id, meta, is_cited, created_at, color, parent_id, path, depth, sort_order)
SELECT m.new_id,
       COALESCE(NULLIF(e.name, ''), e.content),
       EXISTS(SELECT 1 FROM edges x
               WHERE x.target_id = e.id AND x.kind IN ('tagging', 'relation', 'link')),
       e.created_at,
       e.color,
       (SELECT p.new_id FROM _id_map p WHERE p.old_id = e.parent_id),
       e.path,
       e.depth,
       e.sort_order
FROM entities e
JOIN _id_map m ON m.old_id = e.id;

-- ============ 3. edges_new 填数(步 4,spec §2.4)============
-- `child` 原样(两端改 id);`tagging`/`relation`/`link` 并成 `link`,按 `(source_id,target_id)`
-- 去重后 `remark` 取非空者(`MAX`);自指边跳过。边 id 按 `(kind,source_id,target_id)` 稳定序连号。
INSERT INTO edges_new(id, source_id, target_id, kind, remark, created_at)
SELECT ROW_NUMBER() OVER (ORDER BY kind, source_id, target_id),
       source_id, target_id, kind, remark, created_at
FROM (
  SELECT s.new_id AS source_id, t.new_id AS target_id, 'child' AS kind,
         e.remark AS remark, e.created_at AS created_at
  FROM edges e
  JOIN _id_map s ON s.old_id = e.source_id
  JOIN _id_map t ON t.old_id = e.target_id
  WHERE e.kind = 'child'
  UNION ALL
  SELECT s.new_id, t.new_id, 'link', MAX(e.remark), MIN(e.created_at)
  FROM edges e
  JOIN _id_map s ON s.old_id = e.source_id
  JOIN _id_map t ON t.old_id = e.target_id
  WHERE e.kind IN ('tagging', 'relation', 'link') AND s.new_id <> t.new_id
  GROUP BY s.new_id, t.new_id
);

-- ============ 4. 别名与合并日志(步 8)============
-- 别名指向的实体 id 按映射改写(映射不到 = 目标已删,跳过该行)。
INSERT INTO entity_aliases_new(alias, entity_id)
SELECT a.alias, m.new_id
FROM entity_aliases a
JOIN _id_map m ON m.old_id = a.entity_id;

-- 合并日志:补 `meta_snapshot`(被删侧 `meta` 原文快照,历史行为空串,spec §10-P6)并改写两端 id。
-- 映射不到的 id 保持原值(该实体已在历史里被删,日志只读、不参与语义)。
ALTER TABLE entity_merge_log ADD COLUMN meta_snapshot TEXT NOT NULL DEFAULT '';
UPDATE entity_merge_log
   SET source_entity_id = COALESCE((SELECT new_id FROM _id_map WHERE old_id = source_entity_id), source_entity_id),
       target_entity_id = COALESCE((SELECT new_id FROM _id_map WHERE old_id = target_entity_id), target_entity_id);

-- ============ 5. 下架旧表并改名(步 9)============
DROP TABLE entity_aliases;
DROP TABLE edges;
DROP TABLE entities;
ALTER TABLE entities_new RENAME TO entities;
ALTER TABLE edges_new RENAME TO edges;
ALTER TABLE entity_aliases_new RENAME TO entity_aliases;

-- ============ 6. 新索引(步 6,spec §2.5)============
-- `idx_entities_path` 是普通索引(不唯一,已定 P0-1):真库有笔记首行含 `/`,进树后 `path` 可与
-- 既有标签路径串逐字相同。`idx_entities_name` / `idx_entities_sibling_name` 随 `name` 列删除,
-- 同级重名改由写路径按 `entity_key(meta)` 预检(spec §10-P3)。
CREATE INDEX idx_entities_path ON entities(path) WHERE path IS NOT NULL;
CREATE INDEX idx_edges_source ON edges(source_id, kind);
CREATE INDEX idx_edges_target ON edges(target_id, kind);

-- ============ 7. 清临时映射表(步 10)============
DROP TABLE IF EXISTS _id_map;
