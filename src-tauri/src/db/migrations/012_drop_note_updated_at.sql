-- 012: 删除 notes.updated_at 列(spec 2026-09-17 S3)。
-- 该列唯一用途是被 update/toggle_todo 刷新,界面、导出、筛选都不读它;
-- notes.created_at 保留(DB 原生默认值,任何显示都不用它)。
-- 幂等:SQLite 的 ALTER TABLE DROP COLUMN 没有 IF EXISTS,列已不存在时重跑会报
-- 「no such column: updated_at」。故 migrate.rs 在执行本文件前先按 pragma_table_info
-- 判定,列已不在则跳过本语句、只推进 user_version(见 notes_has_column)。
-- 单事务:本文件与 user_version 的推进由 migrate::apply 包在同一事务里一起提交。
-- 无触发器/索引/视图引用 updated_at(只有 notes_update::update 写过它),
-- 故 DROP COLUMN 不需要重建任何对象。
ALTER TABLE notes DROP COLUMN updated_at;
