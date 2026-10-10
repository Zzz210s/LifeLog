//! 030 FTS 闭包 + 导出引用列回归(计划「读侧收口之一」)。
//!
//! 夹具:标签树 `aaa` / `aaa/sub` / `aaa/sub/deep`,`bbb` 为另一根;关系
//! `aaa --(关系)--> bbb`;note1 只挂 `aaa/sub`(关系落在**祖先**上),note2 只挂 `aaa`。
//! ① 搜 `bbb` 命中 note1(祖先关系闭包)与 note2;
//! ② 搜 `aaa/sub/deep` 命中挂 `aaa` 的 note2(子孙闭包);
//! ③ note1 补一条直链 `bbb` 再删掉,搜 `bbb` 仍命中(删边触发器重算闭包);
//! ④ 导出引用列含 `bbb`(note1)与 `aaa/sub/deep`(note2)。
use crate::db::migrate;
use crate::db::repos::settings::{self, FILTER_CURRENT_KEY};
use crate::exchange::notes_export::rows;
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c.execute_batch(
        "INSERT INTO entities(id,meta,created_at,path,depth,parent_id,sort_order) VALUES
           (1,'记一','2026-01-01',NULL,NULL,NULL,0),
           (2,'记二','2026-01-02',NULL,NULL,NULL,0),
           (10,'aaa','2026-01-01','aaa',1,NULL,0),
           (11,'aaa/sub','2026-01-01','aaa/sub',2,10,0),
           (12,'aaa/sub/deep','2026-01-01','aaa/sub/deep',3,11,0),
           (13,'bbb','2026-01-01','bbb',1,NULL,0);
         INSERT INTO edges(source_id,target_id,kind,remark,created_at) VALUES
           (10,13,'link','关系','2026-01-01'),
           (10,11,'child','','2026-01-01'),
           (11,12,'child','','2026-01-01'),
           (1,11,'link','','2026-01-01'),
           (2,10,'link','','2026-01-01');",
    )
    .unwrap();
    c
}

fn set_keyword_filter(c: &Connection, kw: &str) {
    settings::set(
        c,
        FILTER_CURRENT_KEY,
        &format!(
            r#"{{"groupOp":"and","groups":[{{"op":"and","items":[{{"kind":"keyword","value":"{kw}"}}]}}]}}"#
        ),
    )
    .unwrap();
}

fn hit_ids(c: &Connection) -> Vec<i64> {
    rows(c).unwrap().iter().map(|r| r.id).collect()
}

/// ① 祖先关系闭包 + ② 子孙闭包
#[test]
fn search_hits_through_ancestor_relation_and_descendants() {
    let c = db();
    set_keyword_filter(&c, "bbb");
    let ids = hit_ids(&c);
    assert!(ids.contains(&1), "note1 只挂 aaa/sub,应经祖先 aaa --(关系)--> bbb 命中");
    assert!(ids.contains(&2), "note2 直接挂 aaa");

    set_keyword_filter(&c, "aaa/sub/deep");
    let ids = hit_ids(&c);
    assert!(ids.contains(&2), "note2 只挂 aaa,应经子孙闭包命中 aaa/sub/deep");
    assert!(ids.contains(&1), "note1 挂 aaa/sub,其子孙 deep 也进索引");
}

/// ③ 直链删掉后仍命中(edges_ad 触发器重算闭包,不是残留缓存)
#[test]
fn search_still_hits_after_direct_edge_is_deleted() {
    let c = db();
    c.execute(
        "INSERT INTO edges(source_id,target_id,kind,remark,created_at) VALUES(1,13,'link','','2026-01-01')",
        [],
    )
    .unwrap();
    set_keyword_filter(&c, "bbb");
    assert!(hit_ids(&c).contains(&1), "直链存在时命中");
    c.execute("DELETE FROM edges WHERE source_id = 1 AND target_id = 13 AND kind = 'link'", [])
        .unwrap();
    set_keyword_filter(&c, "bbb");
    assert!(hit_ids(&c).contains(&1), "删掉直链 bbb 后仍经祖先关系命中");
}

/// ④ 导出引用列 = 闭包显示名(去重、升序)
#[test]
fn export_refs_include_closure_targets() {
    let c = db();
    let rows = rows(&c).unwrap();
    let r1 = rows.iter().find(|r| r.id == 1).expect("note1 在默认筛选内");
    assert!(
        r1.refs.split(' ').any(|x| x == "bbb"),
        "note1 引用列应含关系闭包目标 bbb:{:?}",
        r1.refs
    );
    let r2 = rows.iter().find(|r| r.id == 2).expect("note2 在默认筛选内");
    assert!(r2.refs.contains("aaa/sub/deep"), "note2 引用列应含子孙闭包:{:?}", r2.refs);
    assert_eq!(r2.refs, "aaa aaa/sub aaa/sub/deep bbb", "直链 + 子孙 + 关系闭包,去重且升序");
}

/// ⑤ 事后新增关系边:挂祖先链的引用源必须立刻重算(edges_fts_closure_ai)
#[test]
fn later_relation_edge_refreshes_ancestor_link_sources() {
    let c = db();
    c.execute(
        "INSERT INTO entities(id,meta,created_at,path,depth,parent_id,sort_order) VALUES(14,'ccc','2026-01-01','ccc',1,NULL,0)",
        [],
    )
    .unwrap();
    c.execute(
        "INSERT OR IGNORE INTO edges(source_id,target_id,kind,remark,created_at) VALUES(10,14,'link','','2026-01-01')",
        [],
    )
    .unwrap();
    set_keyword_filter(&c, "ccc");
    assert!(hit_ids(&c).contains(&2), "后插关系边应刷新挂 aaa 的 note2");
}

/// 真库副本就地迁移读数(默认 ignored):`LIFELOG_CLOSURE_DB=<副本> cargo test --lib
/// migrate_real_db_copy_readout -- --ignored --nocapture`。迁移到最新后打印版本与 FTS 行数。
#[test]
#[ignore = "需 LIFELOG_CLOSURE_DB 指向真库副本(会就地迁移)"]
fn migrate_real_db_copy_readout() {
    let path = std::env::var("LIFELOG_CLOSURE_DB").expect("未设 LIFELOG_CLOSURE_DB");
    let c = Connection::open(&path).unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    let before: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    migrate::run(&c).unwrap();
    let after: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    let ents: i64 = c.query_row("SELECT COUNT(*) FROM entities", [], |r| r.get(0)).unwrap();
    let fts: i64 = c.query_row("SELECT COUNT(*) FROM entities_fts", [], |r| r.get(0)).unwrap();
    eprintln!("副本迁移:{before} -> {after}; entities={ents} entities_fts={fts}");
}
