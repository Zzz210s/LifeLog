//! T3.1 真库全量等价证据(真库只读,须显式 `--ignored` + `LIFELOG_FTS_DB=<库副本路径>`)。
//! 对每条笔记分别用 `TAGS_AGG`(老 notes_fts 口径)与 `ENTITIES_AGG`(新口径)算聚合串,
//! 按 id 升序拼串后取 sha256;两个摘要必须相同 —— 收口只搬家、不改语义。
//! 副本会先迁到最新(含 026,它建好 `entity_aliases` 并从 `tag_aliases` 回填),
//! 故新口径的别名段与老 `tag_aliases` 等价,本用例不再手工补建。
use crate::db::migrate;
use crate::db::repos::entities::fts::ENTITIES_AGG;
use crate::db::repos::tags::fts_tags::TAGS_AGG;
use crate::db::sql_functions;
use rusqlite::Connection;
use sha2::{Digest, Sha256};

#[test]
#[ignore = "需 LIFELOG_FTS_DB 指向真库副本(会迁移副本并补建 entity_aliases)"]
fn real_db_note_aggregate_is_unchanged() {
    let Ok(path) = std::env::var("LIFELOG_FTS_DB") else {
        eprintln!("跳过:未设 LIFELOG_FTS_DB");
        return;
    };
    let c = Connection::open(&path).unwrap();
    sql_functions::register(&c).unwrap();
    migrate::run(&c).unwrap();

    let ids: Vec<i64> = {
        let mut stmt = c.prepare("SELECT id FROM entities WHERE kind='note' ORDER BY id").unwrap();
        stmt.query_map([], |r| r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap()
    };
    let (mut old_hash, mut new_hash) = (Sha256::new(), Sha256::new());
    for id in &ids {
        let old: String = c
            .query_row(&format!("SELECT {TAGS_AGG} FROM notes n WHERE n.id = ?1"), [id], |r| r.get(0))
            .unwrap();
        let new: String = c
            .query_row(
                &format!("SELECT {ENTITIES_AGG} FROM entities e WHERE e.id = ?1"),
                [id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(new, old, "笔记 {id} 的聚合串收口前后不同");
        old_hash.update(format!("{id}\t{old}\n"));
        new_hash.update(format!("{id}\t{new}\n"));
    }
    let (a, b) = (format!("{:x}", old_hash.finalize()), format!("{:x}", new_hash.finalize()));
    println!("笔记数={} TAGS_AGG sha256={a} ENTITIES_AGG sha256={b}", ids.len());
    assert_eq!(a, b, "两口径的全库摘要不同");

    // 标签实体侧读数:老口径不含标签,这里只留新口径的基线摘要与"非空"读数(阶段 3 验收用)
    let tag_ids: Vec<i64> = {
        let mut stmt = c.prepare("SELECT id FROM entities WHERE kind='tag' ORDER BY id").unwrap();
        stmt.query_map([], |r| r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap()
    };
    let mut tag_hash = Sha256::new();
    let mut nonempty = 0usize;
    for id in &tag_ids {
        let v: String = c
            .query_row(
                &format!("SELECT {ENTITIES_AGG} FROM entities e WHERE e.id = ?1"),
                [id],
                |r| r.get(0),
            )
            .unwrap();
        if !v.is_empty() {
            nonempty += 1;
        }
        tag_hash.update(format!("{id}\t{v}\n"));
    }
    println!(
        "标签实体数={} 非空 tag_paths={} ENTITIES_AGG sha256={:x}",
        tag_ids.len(),
        nonempty,
        tag_hash.finalize()
    );
}
