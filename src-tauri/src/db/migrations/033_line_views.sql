-- 033:线语义的唯一处定义(2026-10-27 架构精简 A)。
--
-- 点/线模型只有三种线,但判据此前以字符串形式散落在 Rust 里:
--   `name_id IS NULL` 183 处 = 打标签 / [[链接]]
--   `name_id = 0`      44 处 = 树(子级线,保留名字点「子级」)
-- 任何一次模型微调都要改上百处,漏一处就语义错。这里把三条视图定成唯一真源,
-- 查询改成 `FROM tag_lines` / `FROM tree_lines` / `FROM non_tree_lines`,
-- 语义只在这里解释一次;SQLite 会内联展开简单视图,不改变查询计划(见 §A 实测)。
--
-- 为什么用视图而不是改 Rust 常量:许多 SQL 是 `const &str` 静态拼接,常量无法进入
-- 字符串字面量(`concat!` 只吃字面量);视图让静态 SQL 也能复用同一份定义。
CREATE VIEW IF NOT EXISTS tag_lines AS
  SELECT id, from_id, to_id, name_id FROM lines WHERE name_id IS NULL;

CREATE VIEW IF NOT EXISTS tree_lines AS
  SELECT id, from_id, to_id, name_id FROM lines WHERE name_id = 0;

CREATE VIEW IF NOT EXISTS relation_lines AS
  SELECT id, from_id, to_id, name_id FROM lines WHERE name_id IS NOT NULL AND name_id <> 0;

-- 非结构线 = 引用 / 关系(树线与"引用别人"互斥,容器的沉尾判据依赖这条)
CREATE VIEW IF NOT EXISTS non_tree_lines AS
  SELECT id, from_id, to_id, name_id FROM lines WHERE name_id IS NULL OR name_id <> 0;
