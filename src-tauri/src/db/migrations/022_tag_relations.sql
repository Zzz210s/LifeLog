-- 022: 标签关系统一(设计 2026-10-06 §2 §3)。一条边取代三个概念:
--   tag_links(tag_id = A, target_type = 'tag', target_id = B) = 「A 具有 B 所表示的属性」。
-- ① 原「类型认领」的 'type' 边并入 'tag'(任何标签都可被指向);
-- ② 新增 tag_merge_log:同父同名自动合并的排查日志(只增不改,不参与任何语义);
-- ③ tags.is_type 列取消 —— SQL 无 ALTER TABLE ... DROP COLUMN IF EXISTS,由 Rust 钩子
--    `drop_is_type_column` 按列存在性执行(见 db/migration_hooks.rs)。
--
-- 幂等 / 可重放:迁移用 INSERT OR IGNORE 而不是 UPDATE —— 同一 (tag_id, target_id)
-- 若同时存在 'tag' 与 'type' 两行,UPDATE 会撞主键 (tag_id, target_type, target_id);
-- IGNORE 保留既有 'tag' 行,随后 DELETE 清掉全部 'type' 行,结果与 UPDATE 等价且可重放。
INSERT OR IGNORE INTO tag_links(tag_id, target_type, target_id)
  SELECT tag_id, 'tag', target_id FROM tag_links WHERE target_type = 'type';
DELETE FROM tag_links WHERE target_type = 'type';

-- 排查日志:同父同名自动合并前写一条(源/目标 id、搬走的子标签 id、链接与边数)。
CREATE TABLE IF NOT EXISTS tag_merge_log (
  id              INTEGER PRIMARY KEY,
  source_tag_id   INTEGER NOT NULL,
  target_tag_id   INTEGER NOT NULL,
  moved_child_ids TEXT    NOT NULL DEFAULT '[]',
  note_links      INTEGER NOT NULL DEFAULT 0,
  edges           INTEGER NOT NULL DEFAULT 0,
  at              TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
