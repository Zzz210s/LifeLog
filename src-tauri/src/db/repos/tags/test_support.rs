//! T4.1/T4.7 测试夹具:把阶段 1–3 的老表换成**指向 `entities`/`edges` 的视图**,
//! 让既有标签家族/笔记测试的 SQL 与断言逐字不改地跑在新表上。
//!
//! 阶段 4(027)下架了 `notes`/`tags`/`tag_links`/`tag_aliases` 真表,故这里:
//! ① `tags` / `tag_links` / `tag_aliases` 视图把新表投影回老列名/老方向(只读);
//! ② `notes` 视图 + 三个 INSTEAD OF 触发器把测试里对老表的读写重定向到 `entities`,
//!    覆盖 `INSERT INTO notes(...)` / `UPDATE notes` / `DELETE FROM notes` 的既有夹具写法。
//!
//! 注意:这里只是测试夹具,生产路径阶段 4 后完全走 `entities`/`edges`。
use rusqlite::Connection;

/// 安装夹具:老表视图 + `notes` 读写重定向。`migrate::run` 之后调用。
pub(crate) fn install_entity_views(conn: &Connection) {
    conn.execute_batch(
        "CREATE VIEW notes AS
           SELECT id, content, created_at FROM entities WHERE kind = 'note';
         CREATE TRIGGER t47_notes_insert INSTEAD OF INSERT ON notes BEGIN
           INSERT INTO entities(id, kind, content, created_at)
           VALUES(COALESCE(new.id, (SELECT COALESCE(MAX(id), 0) + 1 FROM entities WHERE kind = 'note')),
                  'note', new.content, COALESCE(new.created_at, datetime('now', 'localtime')));
         END;
         CREATE TRIGGER t47_notes_update INSTEAD OF UPDATE ON notes BEGIN
           UPDATE entities SET content = new.content, created_at = new.created_at
            WHERE id = old.id AND kind = 'note';
         END;
         CREATE TRIGGER t47_notes_delete INSTEAD OF DELETE ON notes BEGIN
           DELETE FROM entities WHERE id = old.id AND kind = 'note';
         END;
         DROP TABLE IF EXISTS tag_links;
         DROP TABLE IF EXISTS tag_aliases;
         DROP TABLE IF EXISTS tags;
         CREATE VIEW tags AS
           SELECT id, name, parent_id, path, depth, sort_order, color
           FROM entities WHERE kind = 'tag';
         CREATE VIEW tag_links AS
           SELECT target_id AS tag_id, 'note' AS target_type, source_id AS target_id, remark
             FROM edges WHERE kind = 'tagging'
           UNION ALL
           SELECT source_id AS tag_id, 'tag' AS target_type, target_id, remark
             FROM edges WHERE kind = 'relation';
         CREATE VIEW tag_aliases AS SELECT alias, entity_id AS tag_id FROM entity_aliases;",
    )
    .unwrap();
}
