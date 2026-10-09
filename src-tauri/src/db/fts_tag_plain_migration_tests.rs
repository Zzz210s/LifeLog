//! 迁移 018 的**升级路径**读数:停在 017 的老库(存量笔记 + 祖先段 md 标签 + 旧索引串)
//! 跑一次 `run` 就到 18,回填把纯文本路径写进索引,同一篇笔记按显示文本可搜。
//! 守卫(018 副本 == 共享常量)与重放幂等见 `tags::fts_tags_tests`。
use super::{run, MIGRATIONS};
use crate::db::repos::notes::{notes_filter::empty, query, FilterConditions};
use crate::db::repos::tags::invariants_tests::assert_fts_matches_edges;
use rusqlite::Connection;

/// 018 之前的位次(1 起);旧库 = 应用到 017
const V_017: usize = 17;

/// 模拟升级前旧库:手工重放前 17 条迁移,版本号停在 17
fn db_at_017() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    for (i, sql) in MIGRATIONS.iter().enumerate().take(V_017) {
        conn.execute_batch(sql).unwrap();
        conn.pragma_update(None, "user_version", (i + 1) as i64).unwrap();
    }
    conn
}

/// 存量数据:五层路径;祖先段是 md 名,叶子链到笔记;祖先有旧名别名(与真实库同形)
fn seed(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO notes(content) VALUES('莽山栈道');
         INSERT INTO tags(name, parent_id, path, depth) VALUES('地点', NULL, '地点', 1);
         INSERT INTO tags(name, parent_id, path, depth)
           VALUES('中国大陆', (SELECT id FROM tags WHERE path='地点'), '地点/中国大陆', 2);
         INSERT INTO tags(name, parent_id, path, depth)
           VALUES('湖南省', (SELECT id FROM tags WHERE path='地点/中国大陆'),
                  '地点/中国大陆/湖南省', 3);
         INSERT INTO tags(name, parent_id, path, depth)
           VALUES('[郴](chēn)州市', (SELECT id FROM tags WHERE path='地点/中国大陆/湖南省'),
                  '地点/中国大陆/湖南省/[郴](chēn)州市', 4);
         INSERT INTO tags(name, parent_id, path, depth)
           VALUES('宜章县', (SELECT id FROM tags WHERE path='地点/中国大陆/湖南省/[郴](chēn)州市'),
                  '地点/中国大陆/湖南省/[郴](chēn)州市/宜章县', 5);
         INSERT INTO tag_links(tag_id, target_type, target_id)
           VALUES((SELECT id FROM tags WHERE path='地点/中国大陆/湖南省/[郴](chēn)州市/宜章县'),
                  'note', 1);
         INSERT INTO tag_aliases(alias, tag_id)
           VALUES('郴chen州市', (SELECT id FROM tags
                  WHERE path='地点/中国大陆/湖南省/[郴](chēn)州市'));",
    )
    .unwrap();
}

/// 升级前(v17)读老 `notes_fts`(此时尚无 `entities_fts`)
fn fts(conn: &Connection) -> String {
    conn.query_row("SELECT tags FROM notes_fts WHERE rowid=1", [], |r| r.get(0)).unwrap()
}

/// 升级后读 `entities_fts`(阶段 4 的索引真源;029 起聚合列叫 `paths`)
fn entity_fts(conn: &Connection) -> String {
    conn.query_row("SELECT paths FROM entities_fts WHERE rowid=1", [], |r| r.get(0)).unwrap()
}

/// 关键词命中数:统一实体后 `query` 的域是全实体,故按旧口径补上「笔记域」条件
/// (`treeMembership=out OR singleLine=multi`,等价于旧 `kind='note'`)
fn hits(conn: &Connection, keyword: &str) -> usize {
    let cond = crate::db::repos::tags::test_support::with_note_domain(FilterConditions {
        keyword: Some(keyword.into()),
        ..empty()
    });
    query(conn, &cond, 0).unwrap().len()
}

/// 停在 017 的旧库:索引串里只有原始 md 路径,显示文本搜不到(这就是 T5 要修的问题)
#[test]
fn v17_index_has_no_plain_path() {
    let c = db_at_017();
    seed(&c);
    assert!(fts(&c).contains("[郴](chēn)州市"), "旧索引串是原始 md 路径:{}", fts(&c));
    assert!(!fts(&c).contains("郴州市"), "前置:升级前显示文本不在老索引串里");
}

/// 升级到 18:回填后按显示文本命中;版本号 / 触发器 / 不变量都对齐
#[test]
fn upgrade_to_18_backfills_plain_paths() {
    let c = db_at_017();
    seed(&c);
    run(&c).unwrap();
    let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(version, super::latest_version(), "升级后应停在最新版本");
    assert!(
        entity_fts(&c).contains("地点/中国大陆/湖南省/郴州市/宜章县"),
        "回填纯文本路径:{}",
        entity_fts(&c)
    );
    assert_eq!(hits(&c, "郴州市"), 1, "显示文本命中(纯文本路径)");
    assert_eq!(hits(&c, "chēn"), 1, "注解字面量仍命中");
    // 祖先标签的旧名不进索引(别名口径仍是 T4 的"直接链接的标签",见 fts_tag_plain_tests)
    assert_eq!(hits(&c, "郴chen州市"), 0, "祖先旧名不进索引");
    assert_fts_matches_edges(&c);
}
