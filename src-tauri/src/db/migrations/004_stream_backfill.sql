-- 004: 为 003 的历史窗口补一次 FTS 回填,并清理 v1(diary)残留
-- 003 建了 notes_fts 与同步触发器,但触发器只覆盖迁移之后的写入;阶段 4 前已存在的 notes
-- 没有 FTS 行,>=3 字符关键词走 FTS 分支永久搜不到(<=2 字符走 LIKE 却能命中,同一功能自相矛盾)。
-- 以 DELETE 起手整体重建,幂等可重复执行。
DELETE FROM notes_fts;
INSERT INTO notes_fts(rowid, content, tags)
SELECT n.id, n.content,
       COALESCE((SELECT group_concat(t.name, ' ') FROM tags t
                 JOIN tag_links l ON l.tag_id = t.id
                 WHERE l.target_type = 'note' AND l.target_id = n.id), '')
FROM notes n;

-- 清理 v1 残留:diary_entries 已在 003 删除,但 tag_links 里 target_type='diary' 的链接与
-- 仅被它引用的孤儿 tag 仍留在库中(当前零 UI 影响,但 delete/set_tags 的孤儿回收会把它算作有效引用)。
DELETE FROM tag_links WHERE target_type <> 'note';
DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM tag_links);
