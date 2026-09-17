-- 013: 删除 done / doing 标签子树(spec 2026-09-17 S5)。
-- 只删这两个标签(含 doing 已有的子孙层级)的 tag_links 与 tags 节点,正文一字不动;
-- 完成状态改由正文里的 Markdown 任务列表(- [ ] / - [x])表达。
-- 幂等:纯条件式 DELETE,重跑命中 0 行不报错(没有 DROP 类语句,不需要跳过守卫)。
-- 单事务:本文件与 user_version 的推进由 migrate::apply 包在同一事务里一起提交;
-- 影响面读数在应用前由 migrate.rs 打到 stderr(warn_drop_done_doing)。
-- 路径前缀比较用 substr 而非 LIKE:存量标签名可能含 % 或 _(与 tags_tree 同一口径)。
-- 先删链接再删节点:tag_links_ad 触发器借这次删除重写受影响笔记的 FTS tags 列,
-- 于是 done/doing 立刻从关键词检索里消失,正文列不受影响。
DELETE FROM tag_links
 WHERE tag_id IN (
   SELECT id FROM tags
    WHERE path = 'done' OR substr(path, 1, 5) = 'done/'
       OR path = 'doing' OR substr(path, 1, 6) = 'doing/'
 );
DELETE FROM tags
 WHERE path = 'done' OR substr(path, 1, 5) = 'done/'
    OR path = 'doing' OR substr(path, 1, 6) = 'doing/';
