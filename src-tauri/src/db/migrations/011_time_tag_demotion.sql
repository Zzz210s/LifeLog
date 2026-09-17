-- 011: 时间标签降级为普通标签(spec 2026-09-17 D2/D3/D5)。
-- ① notes_fts 的 tags 列重新纳入时间标签:取消 009「排除时间子树」的例外 ——
--    时间标签与自建标签完全同权,同样参与关键词搜索。
--    已知代价(明示):搜 `2026`/`11` 这类词会命中该年/该月的全部笔记,这是
--    「时间标签即普通标签」的一致性代价。
-- ② saved_views.conditions 里的 from/to 键删除(日期范围筛选已整体取消,D2);
--    只更新真正含这两个键的行,空表无操作。
-- ③ 登记设置键 auto_time_tag(默认 true)与 time_tag_template(默认 时间排序/{y}/{m}/{d})。
-- 无表结构变更(不新增列、不删表)。
-- 幂等:①DELETE 起手整体重建(与 004/009 同款)②键删掉后条件即不成立 ③INSERT OR IGNORE。
-- 聚合加 `ORDER BY t.path`:同一笔记的索引串确定,与 tags_tree::refresh_fts 口径一致。

-- ①-1 正文更新触发器(去掉时间子树排除,其余与 009 相同)
DROP TRIGGER IF EXISTS notes_au;
CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
  DELETE FROM notes_fts WHERE rowid = old.id;
  INSERT INTO notes_fts(rowid, content, tags)
  VALUES (new.id, new.content, COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path)
    FROM tags t JOIN tag_links l ON l.tag_id = t.id
    WHERE l.target_type = 'note' AND l.target_id = new.id), ''));
END;

-- ①-2 标签链接变化:整行重写该笔记的 FTS(content 取 notes 当前值,tags 取当前聚合)
--     笔记行已不存在时 SELECT 无行,仅完成清理,不会残留悬空索引
DROP TRIGGER IF EXISTS tag_links_ai;
CREATE TRIGGER tag_links_ai AFTER INSERT ON tag_links WHEN new.target_type = 'note' BEGIN
  DELETE FROM notes_fts WHERE rowid = new.target_id;
  INSERT INTO notes_fts(rowid, content, tags)
  SELECT n.id, n.content, COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path)
    FROM tags t JOIN tag_links l ON l.tag_id = t.id
    WHERE l.target_type = 'note' AND l.target_id = n.id), '')
  FROM notes n WHERE n.id = new.target_id;
END;

DROP TRIGGER IF EXISTS tag_links_ad;
CREATE TRIGGER tag_links_ad AFTER DELETE ON tag_links WHEN old.target_type = 'note' BEGIN
  DELETE FROM notes_fts WHERE rowid = old.target_id;
  INSERT INTO notes_fts(rowid, content, tags)
  SELECT n.id, n.content, COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path)
    FROM tags t JOIN tag_links l ON l.tag_id = t.id
    WHERE l.target_type = 'note' AND l.target_id = n.id), '')
  FROM notes n WHERE n.id = old.target_id;
END;

-- ①-3 幂等回填:被 009 清洗过的索引串整体重建一次(含时间标签)
DELETE FROM notes_fts;
INSERT INTO notes_fts(rowid, content, tags)
SELECT n.id, n.content,
       COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path)
                 FROM tags t JOIN tag_links l ON l.tag_id = t.id
                 WHERE l.target_type = 'note' AND l.target_id = n.id), '')
FROM notes n;

-- ② 条件对象清 from/to(JSON1;json_type 为 NULL 说明该键本就不存在)
UPDATE saved_views
   SET conditions = json_remove(conditions, '$.from', '$.to')
 WHERE json_valid(conditions)
   AND (json_type(conditions, '$.from') IS NOT NULL
        OR json_type(conditions, '$.to') IS NOT NULL);

-- ③ 设置键登记(已存在则保留用户当前值:改成别的模板的不许被迁移覆盖)
INSERT OR IGNORE INTO settings(key, value) VALUES('auto_time_tag', 'true');
INSERT OR IGNORE INTO settings(key, value) VALUES('time_tag_template', '时间排序/{y}/{m}/{d}');
