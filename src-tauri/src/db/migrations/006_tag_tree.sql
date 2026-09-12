-- 006: tags 表重建为树(父指针为真源,完整路径为冗余)
-- 单事务由 migrate::run 保证:任一步失败整库回滚。幂等由 user_version 守门。
-- 外键:重建期间必须关闭(migrate.rs 在事务外配对开关)——tag_links 对 tags 有
-- ON DELETE CASCADE,外键 ON 时 DROP TABLE tags 会沿级联把 tag_links 数据删空。

-- ① 新表:约束不写在建表语句里,见下方两个唯一索引
CREATE TABLE tags_new (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  parent_id  INTEGER REFERENCES tags_new(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  depth      INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  color      TEXT
);

-- ② 存量平铺标签一律作根节点:路径 = 原名称,深度 = 1,父为空。
--    名称含空格等不符合新语法的老标签也原样保留,不删不改,保证不丢数据。
INSERT INTO tags_new(id, name, parent_id, path, depth, sort_order, color)
SELECT id, name, NULL, name, 1, 0, color FROM tags;

-- ③ 先删旧的聚合触发器:它们引用 tags 表,而 SQLite 在 ALTER TABLE 改名时会重解析
--    全库触发器,若等到改名后才删,DROP 后再改名会报 "no such table: main.tags"。
--    新触发器在改名后重建(聚合改为完整路径)。
DROP TRIGGER IF EXISTS notes_au;
DROP TRIGGER IF EXISTS tag_links_ai;
DROP TRIGGER IF EXISTS tag_links_ad;

-- ④ 删旧表(此时 tag_links 数据原样保留,id 不变)
DROP TABLE tags;

-- ⑤ 改名(表体内的 parent_id 自引用会自动改为 tags)
ALTER TABLE tags_new RENAME TO tags;

-- ⑥ 同级同名约束必须用表达式索引:根节点 parent_id 为 NULL,而 SQLite 唯一索引把
--    NULL 视为互不相同,直接对 (parent_id, name) 建唯一索引会漏掉根级重名。
--    path 唯一索引同时供前缀查询使用。
CREATE UNIQUE INDEX idx_tags_sibling_name ON tags(COALESCE(parent_id, 0), name);
CREATE UNIQUE INDEX idx_tags_path ON tags(path);

-- ⑦ 重建聚合标签的触发器:tags 列改为聚合完整路径 path(而非节点名)。
--    003 的 notes_au 同样聚合 t.name,一并重建,否则正文更新会把索引写回旧名,
--    出现"搜旧名仍命中"或"搜路径不命中"的漂移。
CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
  DELETE FROM notes_fts WHERE rowid = old.id;
  INSERT INTO notes_fts(rowid, content, tags)
  VALUES (new.id, new.content, COALESCE((SELECT group_concat(t.path, ' ') FROM tags t
    JOIN tag_links l ON l.tag_id = t.id
    WHERE l.target_type = 'note' AND l.target_id = new.id), ''));
END;

CREATE TRIGGER tag_links_ai AFTER INSERT ON tag_links WHEN new.target_type = 'note' BEGIN
  DELETE FROM notes_fts WHERE rowid = new.target_id;
  INSERT INTO notes_fts(rowid, content, tags)
  SELECT n.id, n.content, COALESCE((SELECT group_concat(t.path, ' ') FROM tags t
    JOIN tag_links l ON l.tag_id = t.id
    WHERE l.target_type = 'note' AND l.target_id = n.id), '')
  FROM notes n WHERE n.id = new.target_id;
END;

CREATE TRIGGER tag_links_ad AFTER DELETE ON tag_links WHEN old.target_type = 'note' BEGIN
  DELETE FROM notes_fts WHERE rowid = old.target_id;
  INSERT INTO notes_fts(rowid, content, tags)
  SELECT n.id, n.content, COALESCE((SELECT group_concat(t.path, ' ') FROM tags t
    JOIN tag_links l ON l.tag_id = t.id
    WHERE l.target_type = 'note' AND l.target_id = n.id), '')
  FROM notes n WHERE n.id = old.target_id;
END;

-- ⑧ 幂等回填:重写全部笔记的 FTS 行,聚合口径与上文触发器一致
DELETE FROM notes_fts;
INSERT INTO notes_fts(rowid, content, tags)
SELECT n.id, n.content,
       COALESCE((SELECT group_concat(t.path, ' ') FROM tags t
                 JOIN tag_links l ON l.tag_id = t.id
                 WHERE l.target_type = 'note' AND l.target_id = n.id), '')
FROM notes n;
