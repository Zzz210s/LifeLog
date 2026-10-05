-- 021: 标签类型(types)收进标签系统,删掉 roles/tag_roles 两张平行表(计划 Task 6):
-- 「哪些标签能当类型」= tags 上的开关 is_type(在 Rust 钩子里按列存在性 ADD COLUMN,
-- 因为 SQLite 的 ALTER TABLE 没有 IF NOT EXISTS 也写不进纯 SQL 的条件分支);
-- 「X 是 Y 类型的」= 复用 tag_links 的 (tag_id=X, target_type='type', target_id=Y) 行;
-- 「X 携带 Y」= tag_links 的 'tag' 行,原样不动(真实库 24 条保留)。
-- 旧两表的存量行由 Rust 钩子 `carry_over_role_tables` 在删除前搬进新模型
-- (此处只删表,搬迁与告警都写在钩子里 —— 与 013/014 的惯例一致);本机真实库两表 0 行,零搬迁。
-- DROP TABLE IF EXISTS 本身可重放;整条迁移在 run() 的单事务里提交。
DROP TABLE IF EXISTS tag_roles;
DROP TABLE IF EXISTS roles;
