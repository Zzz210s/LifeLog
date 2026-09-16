-- 010: 视图图标(E3):侧栏自建视图行可带一个图标(lucide 组件名作为稳定键,如 inbox)。
-- icon 列只存名字,长度与字符集([a-z0-9-]、≤40)在命令/仓库层校验(见 views_icon.rs),
-- 渲染白名单在前端 view-icons.tsx(未知名字不渲染、不报错);空串/全空白归一为 NULL。
-- SQLite 的 ALTER TABLE ADD COLUMN 没有 IF NOT EXISTS,幂等由 user_version 守门
-- (SQL 与 user_version 同事务提交,见 migrate::apply);既有行自然得到 NULL。
ALTER TABLE saved_views ADD COLUMN icon TEXT;
