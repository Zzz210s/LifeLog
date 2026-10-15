//! T4 守卫(设计 §7.2 零变化清单 / v31 视图口径):关系名只活在 `lines.name_id` 指向的
//! 名字点上,**不进**「标签路径的纯文本形态」(标量函数 `tag_plain`)与 FTS 聚合。
//! 同一份点 / 线,仅把线的 `name_id` 从空换成名字点,`tag_plain(路径)` 与受影响点的
//! `points_fts.paths` 必须逐字节不变 —— 迁移 018 的 FTS 口径与 031 的视图口径都不认得名字。
use crate::db::migrate;
use rusqlite::{params, Connection};

/// 内存 v31 库:点 1 / 2 是树内点(一个纯文本、一个含行内 md),点 3 是内容点(出线来源),
/// `named` 时再落一个只出现在 `name_id` 位的纯名字点 4,并把线 1 的 `name_id` 指向它。
fn db(named: bool) -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    let name_id = if named { "4" } else { "NULL" };
    let name_point = if named {
        "INSERT INTO points(id, meta, is_cited, created_at, color, parent_id, path, depth, sort_order)
           VALUES(4, '国籍', 0, datetime('now','localtime'), NULL, NULL, NULL, NULL, 0);"
    } else {
        ""
    };
    c.execute_batch(&format!(
        "INSERT INTO points(id, meta, is_cited, created_at, color, parent_id, path, depth, sort_order) VALUES
           (1, '中国大陆', 0, datetime('now','localtime'), NULL, NULL, '地点/中国大陆', 2, 0),
           (2, '郴州市',   0, datetime('now','localtime'), NULL, NULL, '地点/[郴](chēn)州市', 2, 0),
           (3, '苹果',     1, datetime('now','localtime'), NULL, NULL, NULL, NULL, 0);
         {name_point}
         INSERT INTO lines(id, from_id, to_id, name_id, created_at)
           VALUES(1, 3, 1, {name_id}, datetime('now','localtime'));"
    ))
    .unwrap();
    c
}

fn tag_plain(c: &Connection, path: &str) -> String {
    c.query_row("SELECT tag_plain(?1)", [path], |r| r.get(0)).unwrap()
}

fn fts_paths(c: &Connection, id: i64) -> String {
    c.query_row("SELECT paths FROM points_fts WHERE rowid=?1", params![id], |r| r.get(0))
        .unwrap()
}

#[test]
fn tag_plain_ignores_whether_a_relation_name_exists() {
    let plain = db(false);
    let named = db(true);
    for path in ["地点/中国大陆", "[郴](chēn)州市"] {
        assert_eq!(
            tag_plain(&plain, path),
            tag_plain(&named, path),
            "tag_plain({path}) 不得随名线出现而变"
        );
    }
    // 证明测的不是空串:去 md 的可见文本照常产出
    assert_eq!(tag_plain(&plain, "[郴](chēn)州市"), "郴州市");
    assert_eq!(tag_plain(&plain, "地点/中国大陆"), "地点/中国大陆");
}

#[test]
fn fts_aggregate_is_byte_identical_with_relation_name() {
    let plain = db(false);
    let named = db(true);
    for id in [1_i64, 2, 3] {
        assert_eq!(
            fts_paths(&plain, id),
            fts_paths(&named, id),
            "点 {id} 的 points_fts.paths 应逐字节不变"
        );
    }
    assert!(
        !fts_paths(&named, 3).contains("国籍"),
        "名字文本不得进 FTS:{:?}",
        fts_paths(&named, 3)
    );
    // 纯名字点整行不进 FTS(视图 WHERE 过滤)
    let name_rows: i64 = named
        .query_row("SELECT COUNT(*) FROM points_fts WHERE rowid=4", [], |r| r.get(0))
        .unwrap();
    assert_eq!(name_rows, 0, "名字点 4 不得有 points_fts 行");
}
