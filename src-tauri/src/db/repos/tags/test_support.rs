//! T4.1 测试夹具:把阶段 1–3 的老表换成**指向 `entities`/`edges` 的只读视图**,
//! 让既有标签家族测试的 SQL 与断言逐字不改地跑在新表上(计划 T4.1「改夹具建表」)。
//!
//! 三条配套(都是夹具,不是生产路径):
//! ① `notes` 增删改镜像进 `entities(kind='note')` —— `edges` 两端有外键,而 T4.1 只切标签家族,
//!    笔记写路径由 T4.2 接管,夹具先补上,否则 link_note 的外键会失败。
//! ② `tags`/`tag_links`/`tag_aliases` 视图把新表投影回老列名/老方向(不做 DML —— 老表已被替换)。
//! ③ `materialize_legacy` 供 018 重放用例把视图物化成真表(SQLite 不允许在视图上建触发器)。
use rusqlite::Connection;

/// 安装夹具:注释视图 + 笔记镜像触发器。`migrate::run` 之后调用。
pub(crate) fn install_entity_views(conn: &Connection) {
    conn.execute_batch(
        "CREATE TRIGGER t41_notes_ai AFTER INSERT ON notes BEGIN
           INSERT OR IGNORE INTO entities(id, kind, content, created_at)
           VALUES(new.id, 'note', new.content, new.created_at);
         END;
         CREATE TRIGGER t41_notes_au AFTER UPDATE OF content ON notes BEGIN
           UPDATE entities SET content = new.content WHERE id = old.id AND kind = 'note';
         END;
         CREATE TRIGGER t41_notes_ad AFTER DELETE ON notes BEGIN
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

/// 把当前视图物化成同名真表(仅 018 重放用例需要:它要在老表上 CREATE TRIGGER)。
/// 只保证可读/可建触发器,不复制约束 —— 该用例只读这几张表。
pub(crate) fn materialize_legacy(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE _t41_tags AS SELECT * FROM tags;
         CREATE TABLE _t41_links AS SELECT * FROM tag_links;
         CREATE TABLE _t41_aliases AS SELECT * FROM tag_aliases;
         DROP VIEW tag_aliases;
         DROP VIEW tag_links;
         DROP VIEW tags;
         CREATE TABLE tags AS SELECT * FROM _t41_tags;
         CREATE TABLE tag_links AS SELECT * FROM _t41_links;
         CREATE TABLE tag_aliases AS SELECT * FROM _t41_aliases;
         DROP TABLE _t41_tags;
         DROP TABLE _t41_links;
         DROP TABLE _t41_aliases;",
    )
    .unwrap();
}
