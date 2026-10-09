//! 只读:被携带的标签路径集合(条件栏摘要 `+携带` 小字的数据源)。
//! 「被携带」= `edges` 里 `kind='link'` 且**引用方是树内实体**(`ca.path IS NOT NULL`)
//! 的 `target_id` 指向的实体路径,方向与 `filter_predicates::carry_predicate` 一致
//! (携带者 `source_id` -> 被携带 `target_id`)。028 起老 `relation` 边并入 `link`,
//! 树外实体(`path` 为 NULL),如笔记挂标签,不参与携带;`tagging` 边是笔记挂标签,不算。
//! JOIN entities 顺带排掉悬空行,`DISTINCT` 去重、路径升序。
use rusqlite::Connection;

/// 有携带者的标签路径(去重、升序);无携带关系时返回空表
pub fn carried_paths(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT t.path FROM edges l JOIN entities t ON t.id = l.target_id \
         JOIN entities ca ON ca.id = l.source_id \
         WHERE l.kind = 'link' AND ca.path IS NOT NULL AND t.path IS NOT NULL ORDER BY t.path",
    )?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::carried_paths;
    use crate::db::migrate;
    use rusqlite::Connection;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        migrate::run(&c).unwrap();
        c
    }

    /// 直接写新表(028 起无 kind/name/content);`path` 非空 = 树内实体
    fn ent(c: &Connection, id: i64, meta: &str, path: Option<&str>) {
        c.execute(
            "INSERT INTO entities(id, meta, created_at, path, depth) VALUES(?1, ?2, '2026-01-01', ?3, 1)",
            rusqlite::params![id, meta, path],
        )
        .unwrap();
    }

    fn link(c: &Connection, source: i64, target: i64) {
        c.execute(
            "INSERT INTO edges(source_id, target_id, kind, created_at) VALUES(?1, ?2, 'link', '2026-01-01')",
            rusqlite::params![source, target],
        )
        .unwrap();
    }

    /// 笔记(树外)挂标签不算携带;只有树内实体(有 path)的 link 才算
    #[test]
    fn lists_only_tree_entity_carries_not_plain_note_links() {
        let c = db();
        ent(&c, 5, "日本", Some("地点/国籍/日本"));
        ent(&c, 1, "笔记", None);
        link(&c, 1, 5);
        assert!(carried_paths(&c).unwrap().is_empty(), "树外笔记的 link 不算携带");
        ent(&c, 2, "丸尾", Some("作者/丸尾"));
        link(&c, 2, 5);
        assert_eq!(carried_paths(&c).unwrap(), vec!["地点/国籍/日本"]);
    }

    /// 同一标签被多个携带者指向只出一条(去重);多个被携带路径都出现
    #[test]
    fn dedups_multiple_carriers_and_lists_all_paths() {
        let c = db();
        ent(&c, 5, "日本", Some("地点/国籍/日本"));
        ent(&c, 6, "法国", Some("地点/国籍/法国"));
        ent(&c, 2, "甲", Some("作者/甲"));
        ent(&c, 3, "乙", Some("作者/乙"));
        link(&c, 2, 5);
        link(&c, 3, 5);
        link(&c, 2, 6);
        let mut got = carried_paths(&c).unwrap();
        let mut want = vec!["地点/国籍/日本".to_string(), "地点/国籍/法国".to_string()];
        got.sort();
        want.sort();
        assert_eq!(got, want);
    }
}
