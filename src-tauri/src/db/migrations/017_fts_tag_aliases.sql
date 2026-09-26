-- 017: 标签别名纳入 notes_fts 的 tags 列(spec 2026-09-26 tag-label-md,T4)。
-- 问题:标签名支持行内 md 后,索引串里是 md 源码(`[郴](chēn)州市`);trigram 分词下
--   用户会去搜的**显示文本**(`郴州市`)不在其中 -> 3 字以上关键词静默搜不到。
--   T2 已把 md 名字的纯文本形态登记为别名(`郴州市`),纳入即通;连带效果是
--   改名/合并后搜旧名也能找到那篇笔记。
-- 口径的唯一真源是 src/db/repos/tags/fts_tags.rs 的 TAGS_AGG(结构变更重写与维护命令重建
--   都引用它);本文件里的表达式副本由守卫用例 fts_tags_tests 逐条比对(写 FTS 的语句条数
--   必须等于表达式出现次数),分叉即红。SQLite 无法在 .sql 与 Rust 之间共享字符串字面量。
-- 新增 tag_aliases 的三个触发器:别名的增/改/删也要重写受影响笔记的 FTS 行,
--   否则"新登记的别名搜不到""改指向后旧目标仍命中"(别名仓库层改用 upsert 才会走 UPDATE)。
-- 幂等:DROP TRIGGER IF EXISTS + 重建;回填 DELETE 起手整体重建(与 004/009/011 同款)。
-- 聚合两侧各自 `ORDER BY` 后整体 `trim`:同一笔记的索引串确定,且无前导/尾随空格
--   (路径与别名都不含空白:别名登记有校验,标签名同理)。
-- 表别名固定为 `n`(notes):共享表达式只引用 `n.id`,调用方负责把 notes 行别名写成 n。

-- ①-1 正文更新:整行重写(改用与 tag_links 触发器同一形态,避免两套写法分叉)
DROP TRIGGER IF EXISTS notes_au;
CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
  DELETE FROM notes_fts WHERE rowid = old.id;
  INSERT INTO notes_fts(rowid, content, tags)
  SELECT n.id, n.content,
    trim(COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path)
                   FROM tags t JOIN tag_links l ON l.tag_id = t.id
                   WHERE l.target_type = 'note' AND l.target_id = n.id), '')
         || ' ' ||
         COALESCE((SELECT group_concat(a.alias, ' ' ORDER BY a.alias)
                   FROM tag_aliases a
                   WHERE a.tag_id IN (SELECT l2.tag_id FROM tag_links l2
                                      WHERE l2.target_type = 'note' AND l2.target_id = n.id)), ''))
  FROM notes n WHERE n.id = new.id;
END;

-- ①-2 标签链接变化:整行重写该笔记的 FTS(content 取 notes 当前值,tags 取当前聚合)
--      笔记行已不存在时 SELECT 无行,仅完成清理,不会残留悬空索引
DROP TRIGGER IF EXISTS tag_links_ai;
CREATE TRIGGER tag_links_ai AFTER INSERT ON tag_links WHEN new.target_type = 'note' BEGIN
  DELETE FROM notes_fts WHERE rowid = new.target_id;
  INSERT INTO notes_fts(rowid, content, tags)
  SELECT n.id, n.content,
    trim(COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path)
                   FROM tags t JOIN tag_links l ON l.tag_id = t.id
                   WHERE l.target_type = 'note' AND l.target_id = n.id), '')
         || ' ' ||
         COALESCE((SELECT group_concat(a.alias, ' ' ORDER BY a.alias)
                   FROM tag_aliases a
                   WHERE a.tag_id IN (SELECT l2.tag_id FROM tag_links l2
                                      WHERE l2.target_type = 'note' AND l2.target_id = n.id)), ''))
  FROM notes n WHERE n.id = new.target_id;
END;

DROP TRIGGER IF EXISTS tag_links_ad;
CREATE TRIGGER tag_links_ad AFTER DELETE ON tag_links WHEN old.target_type = 'note' BEGIN
  DELETE FROM notes_fts WHERE rowid = old.target_id;
  INSERT INTO notes_fts(rowid, content, tags)
  SELECT n.id, n.content,
    trim(COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path)
                   FROM tags t JOIN tag_links l ON l.tag_id = t.id
                   WHERE l.target_type = 'note' AND l.target_id = n.id), '')
         || ' ' ||
         COALESCE((SELECT group_concat(a.alias, ' ' ORDER BY a.alias)
                   FROM tag_aliases a
                   WHERE a.tag_id IN (SELECT l2.tag_id FROM tag_links l2
                                      WHERE l2.target_type = 'note' AND l2.target_id = n.id)), ''))
  FROM notes n WHERE n.id = old.target_id;
END;

-- ② 别名变化:重写"该标签名下笔记"的 FTS 行(EXISTS 保证一条笔记只写一行;
--    改指向时 old/new 两侧都要刷 - 旧目标不再含该别名,新目标开始含)
DROP TRIGGER IF EXISTS tag_aliases_ai;
CREATE TRIGGER tag_aliases_ai AFTER INSERT ON tag_aliases BEGIN
  DELETE FROM notes_fts WHERE rowid IN (
    SELECT n.id FROM notes n WHERE EXISTS (SELECT 1 FROM tag_links l
      WHERE l.target_type = 'note' AND l.target_id = n.id AND l.tag_id = new.tag_id));
  INSERT INTO notes_fts(rowid, content, tags)
  SELECT n.id, n.content,
    trim(COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path)
                   FROM tags t JOIN tag_links l ON l.tag_id = t.id
                   WHERE l.target_type = 'note' AND l.target_id = n.id), '')
         || ' ' ||
         COALESCE((SELECT group_concat(a.alias, ' ' ORDER BY a.alias)
                   FROM tag_aliases a
                   WHERE a.tag_id IN (SELECT l2.tag_id FROM tag_links l2
                                      WHERE l2.target_type = 'note' AND l2.target_id = n.id)), ''))
  FROM notes n WHERE EXISTS (SELECT 1 FROM tag_links l
    WHERE l.target_type = 'note' AND l.target_id = n.id AND l.tag_id = new.tag_id);
END;

DROP TRIGGER IF EXISTS tag_aliases_au;
CREATE TRIGGER tag_aliases_au AFTER UPDATE ON tag_aliases BEGIN
  DELETE FROM notes_fts WHERE rowid IN (
    SELECT n.id FROM notes n WHERE EXISTS (SELECT 1 FROM tag_links l
      WHERE l.target_type = 'note' AND l.target_id = n.id
        AND l.tag_id IN (old.tag_id, new.tag_id)));
  INSERT INTO notes_fts(rowid, content, tags)
  SELECT n.id, n.content,
    trim(COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path)
                   FROM tags t JOIN tag_links l ON l.tag_id = t.id
                   WHERE l.target_type = 'note' AND l.target_id = n.id), '')
         || ' ' ||
         COALESCE((SELECT group_concat(a.alias, ' ' ORDER BY a.alias)
                   FROM tag_aliases a
                   WHERE a.tag_id IN (SELECT l2.tag_id FROM tag_links l2
                                      WHERE l2.target_type = 'note' AND l2.target_id = n.id)), ''))
  FROM notes n WHERE EXISTS (SELECT 1 FROM tag_links l
    WHERE l.target_type = 'note' AND l.target_id = n.id
      AND l.tag_id IN (old.tag_id, new.tag_id));
END;

DROP TRIGGER IF EXISTS tag_aliases_ad;
CREATE TRIGGER tag_aliases_ad AFTER DELETE ON tag_aliases BEGIN
  DELETE FROM notes_fts WHERE rowid IN (
    SELECT n.id FROM notes n WHERE EXISTS (SELECT 1 FROM tag_links l
      WHERE l.target_type = 'note' AND l.target_id = n.id AND l.tag_id = old.tag_id));
  INSERT INTO notes_fts(rowid, content, tags)
  SELECT n.id, n.content,
    trim(COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path)
                   FROM tags t JOIN tag_links l ON l.tag_id = t.id
                   WHERE l.target_type = 'note' AND l.target_id = n.id), '')
         || ' ' ||
         COALESCE((SELECT group_concat(a.alias, ' ' ORDER BY a.alias)
                   FROM tag_aliases a
                   WHERE a.tag_id IN (SELECT l2.tag_id FROM tag_links l2
                                      WHERE l2.target_type = 'note' AND l2.target_id = n.id)), ''))
  FROM notes n WHERE EXISTS (SELECT 1 FROM tag_links l
    WHERE l.target_type = 'note' AND l.target_id = n.id AND l.tag_id = old.tag_id);
END;

-- ③ 幂等回填:存量索引串里没有别名,整体重建一次(1364 条约秒级)
DELETE FROM notes_fts;
INSERT INTO notes_fts(rowid, content, tags)
SELECT n.id, n.content,
  trim(COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path)
                 FROM tags t JOIN tag_links l ON l.tag_id = t.id
                 WHERE l.target_type = 'note' AND l.target_id = n.id), '')
       || ' ' ||
       COALESCE((SELECT group_concat(a.alias, ' ' ORDER BY a.alias)
                 FROM tag_aliases a
                 WHERE a.tag_id IN (SELECT l2.tag_id FROM tag_links l2
                                    WHERE l2.target_type = 'note' AND l2.target_id = n.id)), ''))
FROM notes n;
