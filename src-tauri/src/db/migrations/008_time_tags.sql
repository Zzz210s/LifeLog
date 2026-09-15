-- 008: 为尚无时间标签的笔记按其 created_at 回填 `时间排序/YYYY/MM/DD`(spec 2026-09-15 第 4.4 节)
-- 单事务由 migrate::run 保证(SQL 与 user_version 同批提交):任一步失败整库回滚,不会留下半棵树。
-- 幂等:只处理"当前没有任何时间标签"的笔记 —— 已有时间标签的(用户手打或本迁移上次已回填)
--       一律不动;语句本身亦用 INSERT OR IGNORE,重复执行是空操作。
-- 解析:日期一律交 SQLite 的 date() 判定 —— 非法值(如 '坏的')返回 NULL,该条被跳过,
--       migrate::run 在此之前会把被跳过的笔记打到 stderr(迁移日志,见 migrate.rs)。
-- 时间标签的形态与判定口径与 Rust 侧 crate::timetag 一致:前缀用 substr 比较,禁 LIKE
--       (标签名可能含 % 或 _,通配符会误伤)。

-- ① 时间根:仅当确实有笔记要回填时创建(否则会留下一个既无链接又无子节点的空容器)
INSERT OR IGNORE INTO tags(name, parent_id, path, depth)
SELECT '时间排序', NULL, '时间排序', 1
WHERE EXISTS (
  SELECT 1 FROM notes n
  WHERE date(n.created_at) IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id
                    WHERE l.target_type = 'note' AND l.target_id = n.id
                      AND (t.path = '时间排序'
                           OR substr(t.path, 1, length('时间排序') + 1) = '时间排序/'))
);

-- ② 年节点(父 = 时间根)
INSERT OR IGNORE INTO tags(name, parent_id, path, depth)
SELECT DISTINCT strftime('%Y', n.created_at),
       (SELECT id FROM tags WHERE path = '时间排序'),
       '时间排序/' || strftime('%Y', n.created_at), 2
FROM notes n
WHERE date(n.created_at) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id
                  WHERE l.target_type = 'note' AND l.target_id = n.id
                    AND (t.path = '时间排序'
                         OR substr(t.path, 1, length('时间排序') + 1) = '时间排序/'));

-- ③ 月节点(父 = 对应年)
INSERT OR IGNORE INTO tags(name, parent_id, path, depth)
SELECT DISTINCT strftime('%m', n.created_at),
       (SELECT id FROM tags WHERE path = '时间排序/' || strftime('%Y', n.created_at)),
       '时间排序/' || strftime('%Y/%m', n.created_at), 3
FROM notes n
WHERE date(n.created_at) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id
                  WHERE l.target_type = 'note' AND l.target_id = n.id
                    AND (t.path = '时间排序'
                         OR substr(t.path, 1, length('时间排序') + 1) = '时间排序/'));

-- ④ 日节点(父 = 对应月)
INSERT OR IGNORE INTO tags(name, parent_id, path, depth)
SELECT DISTINCT strftime('%d', n.created_at),
       (SELECT id FROM tags WHERE path = '时间排序/' || strftime('%Y/%m', n.created_at)),
       '时间排序/' || strftime('%Y/%m/%d', n.created_at), 4
FROM notes n
WHERE date(n.created_at) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id
                  WHERE l.target_type = 'note' AND l.target_id = n.id
                    AND (t.path = '时间排序'
                         OR substr(t.path, 1, length('时间排序') + 1) = '时间排序/'));

-- ⑤ 建链(末级 = 日节点);tag_links 触发器负责把新路径聚合进该笔记的 FTS 行
INSERT OR IGNORE INTO tag_links(tag_id, target_type, target_id)
SELECT (SELECT id FROM tags
        WHERE path = '时间排序/' || strftime('%Y/%m/%d', n.created_at)), 'note', n.id
FROM notes n
WHERE date(n.created_at) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id
                  WHERE l.target_type = 'note' AND l.target_id = n.id
                    AND (t.path = '时间排序'
                         OR substr(t.path, 1, length('时间排序') + 1) = '时间排序/'));
