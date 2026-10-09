//! 【老表名测试夹具·仅测试】统一元数据(v28)前的老词汇(`tags`/`tag_links`/`notes`)
//! 到新表 `entities`/`edges` 的只读投影 + `notes` 读写重定向。
//!
//! 为什么保留(而不是删掉):统一实体前写下的 40+ 个测试文件用老表名写 SQL 与断言,
//! 逐个改写是一次独立的大规模机械重构(改写中易把断言口径改坏);本夹具让那批用例继续
//! 跑在真结构上。它**只服务旧测试向量**:本模块整体是 `#[cfg(test)]`,生产代码结构上引用不到。
//! **新写的用例一律直接对 `entities`/`edges` 写 SQL,不得再依赖这套投影**(彻底删除是独立后续项)。
//!
//! ① `tags` / `tag_links` / `tag_aliases` 视图把新表投影回老列名/老方向(只读);
//! ② `notes` 视图 + 三个 INSTEAD OF 触发器把测试里对老表的读写重定向到 `entities`;
//! ③ 树内实体 = `path IS NOT NULL`(v28 起不再有 `kind`),树外实体(笔记)path 为 NULL。
use rusqlite::Connection;

/// 老用例口径的「笔记域」:统一元数据后 `query` 的域是全实体(spec §4.1:清空筛选即显示标签),
/// 这些用例关心的是迁移前的「全部笔记」,故在测试侧把**迁移 028 预置的默认筛选**
/// (`treeMembership=out OR singleLine=multi`,等价于旧 `kind='note'`)追加进条件,
/// 让按条件过滤的入口(query / count_matching / skeleton / 分组)口径与旧断言一致。
pub(crate) fn note_domain_items() -> Vec<GroupItem> {
    vec![
        GroupItem::TreeMembership { value: "out".into() },
        GroupItem::SingleLine { value: "multi".into() },
    ]
}

/// 给条件追加默认筛选组(op='or');组间关系不变(`group_op` 默认 and)。
pub(crate) fn with_note_domain(mut c: FilterConditions) -> FilterConditions {
    c.groups.push(FilterGroup { op: "or".to_string(), items: note_domain_items() });
    c
}

use crate::db::repos::notes::notes_filter::FilterConditions;
use crate::db::repos::notes::notes_filter_groups::{FilterGroup, GroupItem};

/// 老用例口径的「笔记域」:统一元数据后 `query` 的域是全实体(spec §4.1),
/// 这些用例关心的是树外实体(老 `kind='note'`),在测试侧就地收窄。
pub(crate) fn is_note(conn: &Connection, id: i64) -> bool {
    conn.query_row("SELECT path IS NULL FROM entities WHERE id = ?1", [id], |r| r.get(0))
        .unwrap_or(false)
}

/// 安装夹具:老表视图 + `notes` 读写重定向。`migrate::run` 之后调用。
pub(crate) fn install_legacy_name_views(conn: &Connection) {
    conn.execute_batch(
        "DROP TABLE IF EXISTS tag_links;
         DROP TABLE IF EXISTS tag_aliases;
         DROP TABLE IF EXISTS tags;
         DROP VIEW IF EXISTS tag_links;
         DROP VIEW IF EXISTS tag_aliases;
         DROP VIEW IF EXISTS tags;
         DROP VIEW IF EXISTS notes;
         CREATE VIEW tags AS
           SELECT id, entity_name(meta) AS name, parent_id, path, depth, sort_order, color
             FROM entities WHERE path IS NOT NULL;
         CREATE VIEW tag_links AS
           SELECT t.id AS tag_id, 'note' AS target_type, e.source_id AS target_id, e.remark
             FROM edges e
             JOIN entities t ON t.id = e.target_id
             JOIN entities s ON s.id = e.source_id
            WHERE e.kind = 'link' AND t.path IS NOT NULL AND s.path IS NULL
           UNION ALL
           SELECT s.id AS tag_id, 'tag' AS target_type, e.target_id AS target_id, e.remark
             FROM edges e
             JOIN entities s ON s.id = e.source_id
            WHERE e.kind = 'link' AND s.path IS NOT NULL;
         CREATE VIEW tag_aliases AS SELECT alias, entity_id AS tag_id FROM entity_aliases;
         CREATE VIEW notes AS
           SELECT id, meta AS content, created_at FROM entities WHERE path IS NULL;
         CREATE TRIGGER t47_notes_insert INSTEAD OF INSERT ON notes BEGIN
           INSERT INTO entities(id, meta, created_at)
           VALUES(COALESCE(new.id, (SELECT COALESCE(MAX(id), 0) + 1 FROM entities)),
                  new.content, COALESCE(new.created_at, datetime('now', 'localtime')));
         END;
         CREATE TRIGGER t47_notes_update INSTEAD OF UPDATE ON notes BEGIN
           UPDATE entities SET meta = new.content, created_at = new.created_at
            WHERE id = old.id;
         END;
         CREATE TRIGGER t47_notes_delete INSTEAD OF DELETE ON notes BEGIN
           DELETE FROM entities WHERE id = old.id;
         END;",
    )
    .unwrap();
}
