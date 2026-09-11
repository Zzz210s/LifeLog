-- 003: v2 统一信息流 —— 移除 diary 表,为 notes 建全文索引(FTS5 trigram,支持中文子串)
-- 设计说明:notes_fts 为普通 FTS5 表(非 external content)。
-- external content + 'delete' 命令行要求提供"建索引时的精确值"才能删行,
-- 而标签聚合串在 link 增删/正文更新多路径下极难保证逐字节一致,易造成索引漂移;
-- 普通表可按 rowid 直接 DELETE 后重插,正确性简单可靠,个人笔记量级下双份存储可接受。
DROP TABLE IF EXISTS diary_entries;
CREATE VIRTUAL TABLE notes_fts USING fts5(content, tags, tokenize='trigram');

-- 笔记插入:标签链接在其后写入(tag_links 触发器负责补齐 tags 列),此处 tags 置空
CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, content, tags) VALUES (new.id, new.content, '');
END;

CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
  DELETE FROM notes_fts WHERE rowid = old.id;
END;

-- 正文更新:按当前链接聚合重写 tags(update 命令先改正文后替换链接,最终以链接触发器收敛)
CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
  DELETE FROM notes_fts WHERE rowid = old.id;
  INSERT INTO notes_fts(rowid, content, tags)
  VALUES (new.id, new.content, COALESCE((SELECT group_concat(t.name, ' ') FROM tags t
    JOIN tag_links l ON l.tag_id = t.id
    WHERE l.target_type = 'note' AND l.target_id = new.id), ''));
END;

-- 标签链接变化:整行重写该笔记的 FTS(content 取 notes 当前值,tags 取当前聚合)
-- 笔记行已不存在时 SELECT 无行,仅完成清理,不会残留悬空索引
CREATE TRIGGER tag_links_ai AFTER INSERT ON tag_links WHEN new.target_type = 'note' BEGIN
  DELETE FROM notes_fts WHERE rowid = new.target_id;
  INSERT INTO notes_fts(rowid, content, tags)
  SELECT n.id, n.content, COALESCE((SELECT group_concat(t.name, ' ') FROM tags t
    JOIN tag_links l ON l.tag_id = t.id
    WHERE l.target_type = 'note' AND l.target_id = n.id), '')
  FROM notes n WHERE n.id = new.target_id;
END;

CREATE TRIGGER tag_links_ad AFTER DELETE ON tag_links WHEN old.target_type = 'note' BEGIN
  DELETE FROM notes_fts WHERE rowid = old.target_id;
  INSERT INTO notes_fts(rowid, content, tags)
  SELECT n.id, n.content, COALESCE((SELECT group_concat(t.name, ' ') FROM tags t
    JOIN tag_links l ON l.tag_id = t.id
    WHERE l.target_type = 'note' AND l.target_id = n.id), '')
  FROM notes n WHERE n.id = old.target_id;
END;
