-- 007: 自建视图(MVP-3 视图系统):侧栏「视图」分区的用户保存视图。
-- 内置视图(全部/待办/无标签)早年是代码常量不入表;视图模块已随迁移 014 删除。
-- conditions 列存条件对象 JSON(写库前已 validate;新表从空起步,无需回填)。
-- 单事务由 migrate::run 保证(SQL 与 user_version 同批提交);幂等由 user_version 守门,
-- 语句本身亦用 IF NOT EXISTS,直接重放也是空操作。
CREATE TABLE IF NOT EXISTS saved_views (
  id         INTEGER PRIMARY KEY,
  title      TEXT NOT NULL,
  conditions TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_saved_views_sort ON saved_views(sort_order);
