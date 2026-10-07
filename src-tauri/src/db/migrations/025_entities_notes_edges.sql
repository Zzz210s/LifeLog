-- 025: 统一实体第二步 —— 把笔记搬入 `entities(kind='note')`,并从老链接表回填
-- `tagging` / `relation` / `link` 三类边。老表(`notes` / `tags` / `tag_links` / `note_links` /
-- `tag_aliases` / `tag_merge_log`)一个字节不改:阶段 1–3 老表仍是应用真源(计划 P0-a),
-- 阶段 4(027)一次切换;因此本文件没有同步触发器。
--
-- 笔记 id **保持原值**(spec §12 D1):时间线序靠 `ORDER BY id`,重编会打乱;标签 id 继续用
-- 024 的 `TAG_ID_OFFSET = 1000000000` 区间,两段永久不撞。
-- `tagging` 方向 = **笔记 → 标签**(spec §2.1):老 `tag_links` 存的是「标签→笔记」,这里逐行翻转。
-- `link` 边只搬 `note_links.target_id` 非空的行(spec §12 D2 选项 A:未解析不落边)。
--
-- 可重放:数据一律 `INSERT OR IGNORE`;老表 `tag_links.target_id` / `note_links.target_id` 无外键,
-- 历史脏行(指向已删行)用 `EXISTS` 守,不让悬挂引用中断迁移。

-- ============ 笔记搬入(name=NULL、content/created_at 原值、legacy_id 溯源)============
INSERT OR IGNORE INTO entities
  (id, kind, name, content, created_at, color, parent_id, path, depth, sort_order, legacy_id)
SELECT n.id, 'note', NULL, n.content, n.created_at, NULL, NULL, NULL, NULL, 0, n.id
FROM notes n;

-- ============ tagging 边:笔记 -> 标签(标签端加偏移)============
INSERT OR IGNORE INTO edges(source_id, target_id, kind, remark, created_at)
SELECT l.target_id,
       l.tag_id + 1000000000,
       'tagging',
       '',
       strftime('%Y-%m-%dT%H:%M:%f','now','localtime')
FROM tag_links l
WHERE l.target_type = 'note'
  AND EXISTS (SELECT 1 FROM notes n WHERE n.id = l.target_id)
  AND EXISTS (SELECT 1 FROM tags t WHERE t.id = l.tag_id);

-- ============ relation 边:标签 -> 标签(024 已回填;本段幂等,兜历史重放/半应用)============
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

-- ============ link 边:实体 -> 实体(两端 id 原值;未解析 target_id IS NULL 不落边)============
INSERT OR IGNORE INTO edges(source_id, target_id, kind, remark, created_at)
SELECT l.source_id,
       l.target_id,
       'link',
       '',
       strftime('%Y-%m-%dT%H:%M:%f','now','localtime')
FROM note_links l
WHERE l.target_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM notes s WHERE s.id = l.source_id)
  AND EXISTS (SELECT 1 FROM notes d WHERE d.id = l.target_id);
