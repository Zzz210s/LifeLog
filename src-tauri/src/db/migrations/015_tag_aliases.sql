-- 015: 标签别名表(spec 2026-09-20 §3.1)。别名不是节点:不进树、不计入计数、不参与 FTS 标签列。
-- 删除目标标签时由 CASCADE 清理由(db::open 已开 foreign_keys=ON)。
-- 幂等:CREATE TABLE IF NOT EXISTS(与 007 同一做法),重放 015 是空操作;
-- 单事务由 migrate::run 保证(SQL 与 user_version 同批提交,失败整批回滚)。
-- 索引:主键已足够(只在解析时按 alias 精确查询)。
CREATE TABLE IF NOT EXISTS tag_aliases (
  alias  TEXT PRIMARY KEY,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE
);
