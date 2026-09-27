-- 018: notes_fts 的 tags 列纳入「标签完整路径的纯文本形态」(spec 2026-09-26 tag-label-md,T5)。
-- 问题(T4 之后仍在的真缺口):笔记链的是**叶子**标签 `地点/…/[郴](chēn)州市/宜章县`,
--   带 md 的名字在**祖先段**上;T4 只并了"该笔记直接链的标签"的别名,拿不到祖先段的别名,
--   于是用户搜界面上看到的 `郴州市` 仍 0 条(trigram 分词下路径里的 `[郴](chēn)州市`
--   不产生 `郴州市` 这个 3-gram)。修法:把链接标签**完整路径的纯文本形态**也索引进去
--   —— 纯文本路径里就含 `郴州市`,祖先段的注解自然被覆盖。
-- 别名口径保持 T4 的范围(只该笔记**直接链的标签**):把祖先标签的旧名也算进来会违反既有
--   不变量「改名后旧路径不得残留」(tree_time_ops_tests 明钉),故不扩到祖先链。
--
-- 口径的唯一真源是 src/db/repos/tags/fts_tags.rs 的 TAGS_AGG(结构变更重写与维护命令重建
--   都引用它);本文件里的表达式副本由守卫用例 fts_tags_tests 逐条比对(写 FTS 的语句条数
--   必须等于表达式出现次数),分叉即红。SQLite 无法在 .sql 与 Rust 之间共享字符串字面量。
-- 新增 tag_plain(路径):连接级标量函数,复用 tag_label::label_plain,在 db::open_with 与
--   migrate::run / apply 注册(db/sql_functions.rs)。**本迁移的回填与它重建的六个触发器都
--   依赖宿主已注册这个函数**:自建连接直接 execute_batch 这段 SQL 会报 `no such function`
--   (测试夹具要自己 sql_functions::register,或走 migrate::run / apply)。
-- 每段用 COALESCE(' ' || ..., '') 拼:空段整段消失,不会留下多余空格(trim 只兜两端),
--   故无 md/无别名的普通标签索引串与 017 逐字节一致。
-- 幂等:DROP TRIGGER IF EXISTS + 重建;回填 DELETE 起手整体重建(与 004/009/011 同款)。
-- 表别名固定为 `n`(notes):共享表达式只引用 `n.id`,调用方负责把 notes 行别名写成 n。

-- ①-1 正文更新:整行重写(与旧触发器等款,仅聚合口径多一段纯文本路径)
DROP TRIGGER IF EXISTS notes_au;
CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
  DELETE FROM notes_fts WHERE rowid = old.id;
  INSERT INTO notes_fts(rowid, content, tags)
  SELECT n.id, n.content,
    trim(COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path)
                   FROM tags t JOIN tag_links l ON l.tag_id = t.id
                   WHERE l.target_type = 'note' AND l.target_id = n.id), '')
      || COALESCE(' ' || (SELECT group_concat(tag_plain(t.path), ' ' ORDER BY t.path)
                   FROM tags t JOIN tag_links l ON l.tag_id = t.id
                   WHERE l.target_type = 'note' AND l.target_id = n.id
                     AND tag_plain(t.path) <> t.path), '')
      || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias)
                   FROM tag_aliases a WHERE a.tag_id IN (SELECT l2.tag_id FROM tag_links l2
                         WHERE l2.target_type = 'note' AND l2.target_id = n.id)), ''))
  FROM notes n WHERE n.id = new.id;
END;

-- ①-2 标签链接变化:整行重写该笔记的 FTS(content 取 notes 当前值,tags 取当前聚合)
DROP TRIGGER IF EXISTS tag_links_ai;
CREATE TRIGGER tag_links_ai AFTER INSERT ON tag_links WHEN new.target_type = 'note' BEGIN
  DELETE FROM notes_fts WHERE rowid = new.target_id;
  INSERT INTO notes_fts(rowid, content, tags)
  SELECT n.id, n.content,
    trim(COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path)
                   FROM tags t JOIN tag_links l ON l.tag_id = t.id
                   WHERE l.target_type = 'note' AND l.target_id = n.id), '')
      || COALESCE(' ' || (SELECT group_concat(tag_plain(t.path), ' ' ORDER BY t.path)
                   FROM tags t JOIN tag_links l ON l.tag_id = t.id
                   WHERE l.target_type = 'note' AND l.target_id = n.id
                     AND tag_plain(t.path) <> t.path), '')
      || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias)
                   FROM tag_aliases a WHERE a.tag_id IN (SELECT l2.tag_id FROM tag_links l2
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
      || COALESCE(' ' || (SELECT group_concat(tag_plain(t.path), ' ' ORDER BY t.path)
                   FROM tags t JOIN tag_links l ON l.tag_id = t.id
                   WHERE l.target_type = 'note' AND l.target_id = n.id
                     AND tag_plain(t.path) <> t.path), '')
      || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias)
                   FROM tag_aliases a WHERE a.tag_id IN (SELECT l2.tag_id FROM tag_links l2
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
      || COALESCE(' ' || (SELECT group_concat(tag_plain(t.path), ' ' ORDER BY t.path)
                   FROM tags t JOIN tag_links l ON l.tag_id = t.id
                   WHERE l.target_type = 'note' AND l.target_id = n.id
                     AND tag_plain(t.path) <> t.path), '')
      || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias)
                   FROM tag_aliases a WHERE a.tag_id IN (SELECT l2.tag_id FROM tag_links l2
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
      || COALESCE(' ' || (SELECT group_concat(tag_plain(t.path), ' ' ORDER BY t.path)
                   FROM tags t JOIN tag_links l ON l.tag_id = t.id
                   WHERE l.target_type = 'note' AND l.target_id = n.id
                     AND tag_plain(t.path) <> t.path), '')
      || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias)
                   FROM tag_aliases a WHERE a.tag_id IN (SELECT l2.tag_id FROM tag_links l2
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
      || COALESCE(' ' || (SELECT group_concat(tag_plain(t.path), ' ' ORDER BY t.path)
                   FROM tags t JOIN tag_links l ON l.tag_id = t.id
                   WHERE l.target_type = 'note' AND l.target_id = n.id
                     AND tag_plain(t.path) <> t.path), '')
      || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias)
                   FROM tag_aliases a WHERE a.tag_id IN (SELECT l2.tag_id FROM tag_links l2
                         WHERE l2.target_type = 'note' AND l2.target_id = n.id)), ''))
  FROM notes n WHERE EXISTS (SELECT 1 FROM tag_links l
    WHERE l.target_type = 'note' AND l.target_id = n.id AND l.tag_id = old.tag_id);
END;

-- ③ 幂等回填:存量索引串里没有纯文本路径,整体重建一次(1364 条约秒级)
DELETE FROM notes_fts;
INSERT INTO notes_fts(rowid, content, tags)
SELECT n.id, n.content,
  trim(COALESCE((SELECT group_concat(t.path, ' ' ORDER BY t.path)
                 FROM tags t JOIN tag_links l ON l.tag_id = t.id
                 WHERE l.target_type = 'note' AND l.target_id = n.id), '')
    || COALESCE(' ' || (SELECT group_concat(tag_plain(t.path), ' ' ORDER BY t.path)
                 FROM tags t JOIN tag_links l ON l.tag_id = t.id
                 WHERE l.target_type = 'note' AND l.target_id = n.id
                   AND tag_plain(t.path) <> t.path), '')
    || COALESCE(' ' || (SELECT group_concat(a.alias, ' ' ORDER BY a.alias)
                 FROM tag_aliases a WHERE a.tag_id IN (SELECT l2.tag_id FROM tag_links l2
                       WHERE l2.target_type = 'note' AND l2.target_id = n.id)), ''))
FROM notes n;
