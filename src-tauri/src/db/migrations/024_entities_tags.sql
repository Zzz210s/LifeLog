-- 024: 统一实体第一步 —— 建 `entities` / `edges`,把标签搬进 `entities(kind='tag')`,
-- 并把**只涉及标签**的边(`child` / `relation`)搬进 `edges`。老表(`tags` / `tag_links` /
-- `tag_aliases` / `tag_merge_log` / `notes` / `note_links`)一个字节不改:阶段 1–3 老表仍是
-- 应用真源(计划 P0-a),阶段 4(027)一次切换;因此本文件没有同步触发器,也不动老表。
--
-- 标签 id 整体偏移 `TAG_ID_OFFSET` = 1000000000(spec §12 D1;真库 max(tags.id)=845、
-- max(notes.id)=1399,偏移后两个区间永久不撞)。老表保持老 id,新表用新 id。
-- 字面量由 `repos/entities/mod.rs` 的常量守卫(用例 offset_literal_matches_const)。
--
-- 可重放:表 / 索引一律 IF NOT EXISTS,数据一律 INSERT OR IGNORE —— 崩溃后重跑不炸、不翻倍。

-- ============ entities(spec §1.1)============
CREATE TABLE IF NOT EXISTS entities (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('note','tag')),
  name       TEXT,                        -- 标签:单段名(非完整路径);笔记:NULL
  content    TEXT NOT NULL DEFAULT '',    -- 笔记正文;标签恒空串
  created_at TEXT NOT NULL,
  color      TEXT,                        -- 标签可能有;笔记恒 NULL
  -- 树派生缓存(仅 kind='tag' 有意义;真相 = child 边,写路径同事务维护)
  parent_id  INTEGER,
  path       TEXT,
  depth      INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  legacy_id  INTEGER                      -- 迁移溯源:老 notes.id / tags.id
);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name) WHERE name IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_path ON entities(path) WHERE kind='tag';
CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_sibling_name
  ON entities(COALESCE(parent_id,0), name) WHERE kind='tag';

-- ============ edges(spec §2;带 FK,阶段 2 不再整表重建)============
CREATE TABLE IF NOT EXISTS edges (
  id         INTEGER PRIMARY KEY,
  source_id  INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_id  INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('child','tagging','relation','link')),
  remark     TEXT NOT NULL DEFAULT '',    -- 仅 relation 用(属性名);其余恒空串
  created_at TEXT NOT NULL,
  UNIQUE (source_id, kind, target_id)     -- 同向同类边天然去重(与今天主键同口径)
);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id, kind);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id, kind);

-- ============ 标签搬入(name/path/depth/sort_order/color 原值;父指针同样偏移)============
-- NULL 父指针 + 偏移仍为 NULL(SQLite 的 NULL 运算);created_at 取迁移执行时间(标签不参与排序)。
INSERT OR IGNORE INTO entities
  (id, kind, name, content, created_at, color, parent_id, path, depth, sort_order, legacy_id)
SELECT t.id + 1000000000,
       'tag',
       t.name,
       '',
       strftime('%Y-%m-%dT%H:%M:%f','now','localtime'),
       t.color,
       t.parent_id + 1000000000,
       t.path,
       t.depth,
       t.sort_order,
       t.id
FROM tags t;

-- ============ child 边:父 -> 子,两端偏移 ============
INSERT OR IGNORE INTO edges(source_id, target_id, kind, remark, created_at)
SELECT t.parent_id + 1000000000,
       t.id + 1000000000,
       'child',
       '',
       strftime('%Y-%m-%dT%H:%M:%f','now','localtime')
FROM tags t
WHERE t.parent_id IS NOT NULL;

-- ============ relation 边:标签 -> 标签,属性名(remark)搬到边上(迁移 023 口径不变)============
-- 两端都必须是已搬入的标签实体;历史重放里指向已删标签的行跳过(EXISTS 守),不因悬挂引用中断迁移。
INSERT OR IGNORE INTO edges(source_id, target_id, kind, remark, created_at)
SELECT l.tag_id + 1000000000,
       l.target_id + 1000000000,
       'relation',
       COALESCE(l.remark, ''),
       strftime('%Y-%m-%dT%H:%M:%f','now','localtime')
FROM tag_links l
WHERE l.target_type IN ('tag', 'type')
  AND EXISTS (SELECT 1 FROM tags s WHERE s.id = l.tag_id)
  AND EXISTS (SELECT 1 FROM tags d WHERE d.id = l.target_id);
