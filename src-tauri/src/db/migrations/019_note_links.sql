-- 019: 笔记间的显式链接(`[[标题]]`,设计 D5)。纯加表:不动既有行、不重建 FTS。
-- source 没了整行跟着删(CASCADE);target 删了只把链接退回未解析(SET NULL),
-- 因为正文里那句 `[[标题]]` 仍在,将来同名笔记出现时会重新解析。
-- 幂等:CREATE TABLE/INDEX IF NOT EXISTS(与 007/015 同一做法),直接重放 019 是空操作;
-- 单事务由 migrate::run 保证(SQL 与 user_version 同批提交,失败整批回滚)。
-- 降级提示:旧版 exe 打开新库不会崩(它不认这张表),但再升级回来时迁移不重跑 —— 与 016 同口径。
CREATE TABLE IF NOT EXISTS note_links (
  id         INTEGER PRIMARY KEY,
  source_id  INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_id  INTEGER          REFERENCES notes(id) ON DELETE SET NULL,
  raw_title  TEXT    NOT NULL,
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS note_links_source ON note_links(source_id);
CREATE INDEX IF NOT EXISTS note_links_target ON note_links(target_id);
