-- 009: 把时间子树标签排除出 FTS 的 tags 列(时间由日期筛选负责,不靠关键词)
-- 问题:006 重建的聚合触发器把**全部**标签路径塞进 tags 列,系统时间标签
--       `时间排序/YYYY/MM/DD` 也在其中,于是:
--         * 关键词 >=3 字符走 FTS(trigram),搜 `2026` 命中该时段全部笔记;
--         * 关键词 <=2 字符退化 LIKE,`t.path LIKE '%11%'` / '%09%' 同样命中整段时期。
--       笔记越多污染面越大,关键词搜索被系统元数据拖垮。
-- 修法:重建三个聚合触发器 + 全量幂等回填,聚合只收**时间子树之外**的完整路径
--       (裸根 `时间排序` 也算时间子树:它同样是系统元数据)。
--       聚合加 `ORDER BY t.path`:同一笔记的索引串确定,与 tags_tree::refresh_fts 口径一致。
-- 幂等:DELETE 起手整体重建,重复执行结果不变(与 004/006 的自愈回填同款)。
-- 口径与 Rust 侧 crate::timetag 一致:前缀用 substr 比较,禁 LIKE(标签名可能含 % 或 _)。

-- ① 正文更新:按当前链接聚合重写 tags(update 命令先改正文后替换链接,最终以链接触发器收敛)
DROP TRIGGER IF EXISTS notes_au;
CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
  DELETE FROM notes_fts WHERE rowid = old.id;
  INSERT INTO notes_fts(rowid, content, tags)
  VALUES (new.id, new.content, COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path)
    FROM tags t JOIN tag_links l ON l.tag_id = t.id
    WHERE l.target_type = 'note' AND l.target_id = new.id
      AND NOT (t.path = '时间排序'
               OR substr(t.path, 1, length('时间排序') + 1) = '时间排序/')), ''));
END;

-- ② 标签链接变化:整行重写该笔记的 FTS(content 取 notes 当前值,tags 取当前聚合)
--    笔记行已不存在时 SELECT 无行,仅完成清理,不会残留悬空索引
DROP TRIGGER IF EXISTS tag_links_ai;
CREATE TRIGGER tag_links_ai AFTER INSERT ON tag_links WHEN new.target_type = 'note' BEGIN
  DELETE FROM notes_fts WHERE rowid = new.target_id;
  INSERT INTO notes_fts(rowid, content, tags)
  SELECT n.id, n.content, COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path)
    FROM tags t JOIN tag_links l ON l.tag_id = t.id
    WHERE l.target_type = 'note' AND l.target_id = n.id
      AND NOT (t.path = '时间排序'
               OR substr(t.path, 1, length('时间排序') + 1) = '时间排序/')), '')
  FROM notes n WHERE n.id = new.target_id;
END;

DROP TRIGGER IF EXISTS tag_links_ad;
CREATE TRIGGER tag_links_ad AFTER DELETE ON tag_links WHEN old.target_type = 'note' BEGIN
  DELETE FROM notes_fts WHERE rowid = old.target_id;
  INSERT INTO notes_fts(rowid, content, tags)
  SELECT n.id, n.content, COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path)
    FROM tags t JOIN tag_links l ON l.tag_id = t.id
    WHERE l.target_type = 'note' AND l.target_id = n.id
      AND NOT (t.path = '时间排序'
               OR substr(t.path, 1, length('时间排序') + 1) = '时间排序/')), '')
  FROM notes n WHERE n.id = old.target_id;
END;

-- ③ 幂等回填:已有 FTS 行都带着时间标签(008 回填建链时写入),整体重建一次
DELETE FROM notes_fts;
INSERT INTO notes_fts(rowid, content, tags)
SELECT n.id, n.content,
       COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path)
                 FROM tags t JOIN tag_links l ON l.tag_id = t.id
                 WHERE l.target_type = 'note' AND l.target_id = n.id
                   AND NOT (t.path = '时间排序'
                            OR substr(t.path, 1, length('时间排序') + 1) = '时间排序/')), '')
FROM notes n;
