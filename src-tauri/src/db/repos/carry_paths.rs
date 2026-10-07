//! 只读:被携带的标签路径集合(条件栏摘要 `+携带` 小字的数据源)。
//! 「被携带」= `edges` 里 `kind='relation'` 的 `target_id` 指向的标签实体,
//! 方向与 `filter_predicates::carry_predicate` 一致(携带者 `source_id` -> 被携带 `target_id`)。
//! JOIN entities 顺带排掉悬空行,`DISTINCT` 去重、路径升序;`tagging` 边是笔记挂标签,不参与。
use rusqlite::Connection;

/// 有携带者的标签路径(去重、升序);无携带关系时返回空表
pub fn carried_paths(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT t.path FROM edges l JOIN entities t ON t.id = l.target_id \
         AND t.kind = 'tag' WHERE l.kind = 'relation' ORDER BY t.path",
    )?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::carried_paths;
    use crate::db::migrate;
    use crate::db::repos::notes::create_plain;
    use crate::db::repos::tags::{ensure_path, set_tag_relation};
    use rusqlite::Connection;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        migrate::run(&c).unwrap();
        c
    }

    /// 笔记挂标签是 'note' 行,不是携带;只有 `'tag'` 行才算,且携带者本身不算「被携带」
    #[test]
    fn lists_only_tag_carries_not_note_links() {
        let mut c = db();
        let carried = ensure_path(&c, &["地点/国籍/日本".into()]).unwrap();
        create_plain(&mut c, "笔记 #地点/国籍/日本").unwrap();
        assert!(carried_paths(&c).unwrap().is_empty(), "笔记链接不算携带");
        let carrier = ensure_path(&c, &["作者/丸尾".into()]).unwrap();
        set_tag_relation(&mut c, carrier, carried, "").unwrap();
        assert_eq!(carried_paths(&c).unwrap(), vec!["地点/国籍/日本"]);
    }

    /// 同一标签被多个携带者指向只出一条(去重);多个被携带路径都出现
    #[test]
    fn dedups_multiple_carriers_and_lists_all_paths() {
        let mut c = db();
        let japan = ensure_path(&c, &["地点/国籍/日本".into()]).unwrap();
        let france = ensure_path(&c, &["地点/国籍/法国".into()]).unwrap();
        let a = ensure_path(&c, &["作者/甲".into()]).unwrap();
        let b = ensure_path(&c, &["作者/乙".into()]).unwrap();
        set_tag_relation(&mut c, a, japan, "").unwrap();
        set_tag_relation(&mut c, b, japan, "").unwrap();
        set_tag_relation(&mut c, a, france, "").unwrap();
        let mut got = carried_paths(&c).unwrap();
        let mut want = vec!["地点/国籍/日本".to_string(), "地点/国籍/法国".to_string()];
        got.sort();
        want.sort();
        assert_eq!(got, want);
    }
}
