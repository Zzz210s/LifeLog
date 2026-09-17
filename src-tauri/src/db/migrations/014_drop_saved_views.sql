-- 014: 删除视图模块(spec 2026-09-17 S6)。自建视图整体被 VSCode 式标签页取代(S7):
-- 一个标签页只存「条件快照 + 标题」,落在 settings 的 tabs_state 键里,不再自建表。
-- ① 删表 saved_views(索引随表一起消失,无需单独 DROP)。
-- ② 删设置键 filter_last:它原先与视图并行维护"上次筛选条件",标签页接管后
--    当前活动页的条件就是唯一真源(见 use-tabs),两套状态必须只留一套。
-- 保留:表达式逃生舱、条件对象、标签筛选语义都不动;内置三预设改为标签页预设(前端常量)。
-- 幂等:DROP TABLE IF EXISTS 与 DELETE 均可重放;单事务由 migrate::run 保证
-- (SQL 与 user_version 同批提交,失败整批回滚)。
DROP TABLE IF EXISTS saved_views;

DELETE FROM settings WHERE key = 'filter_last';
