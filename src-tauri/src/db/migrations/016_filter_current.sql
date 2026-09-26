-- 016: 当前筛选条件从多页 tabs_state 收成单份 filter_current(spec 2026-09-25 §2)。
-- 键搬迁的"取值"部分 SQL 做不了(要解析 JSON 取活动页),放在 migrate.rs 的 016 前置钩子
-- carry_over_filter_current 里:读 tabs_state 的活动页条件 -> 写 filter_current(已存在不覆盖)。
-- 本迁移体只删旧键;旧键此时已无消费者(前端 use-tabs 随标签页模块一起删)。
-- 幂等:DELETE 可重放;单事务由 migrate::run 保证(SQL 与 user_version 同批提交,失败整批回滚)。
DELETE FROM settings WHERE key = 'tabs_state';

-- 降级提示:旧版 exe(≤15)打开已迁到 16 的库不会崩(版本闸门跳过全部迁移,本迁移也不改 schema),
-- 但旧版会把筛选状态重新写回 tabs_state;再升级回来时本迁移已被闸门挡住不会重跑 -> 那段筛选成为死键。
-- 即:降级期间不要改筛选。
