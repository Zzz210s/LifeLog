//! 行为等价对账(计划 Task 1 §要点 / 设计 §10 R8):同一份「类型认领 + 携带」数据,
//! 迁移 022 前(旧谓词读 `'type'` 行)与迁移后(新谓词读 `'tag'` 行)的命中集必须逐值相同。
//! 「改前」用与旧 `type_predicate` 逐字一致的 SQL 手工算(不接受被测代码参与对照),
//! 「改后」走生产 `query` + 类型条件;两侧各给读数。
use crate::db::repos::notes::{create_plain, notes_filter::*, query};
use crate::db::repos::tags::{ensure_path, set_tag_relation};
use crate::db::migrate;
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    crate::db::repos::tags::test_support::install_entity_views(&c);
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    c
}

/// 旧 `type_predicate` 的命中集(手工 SQL:认领侧读 'type' 行 ∪ 携带侧读 'tag' 行)
fn old_relation_hits(c: &Connection, path: &str) -> Vec<String> {
    let sql = "SELECT DISTINCT n.content FROM notes n \
         JOIN tag_links l ON l.target_type='note' AND l.target_id=n.id \
         JOIN tags t ON t.id=l.tag_id \
         WHERE EXISTS (SELECT 1 FROM tags c JOIN tag_links tl ON tl.tag_id=c.id AND tl.target_type='type' \
                         JOIN tags rt ON rt.id=tl.target_id \
                        WHERE rt.path=?1 AND (t.path=c.path OR substr(t.path,1,length(c.path)+1)=c.path||'/')) \
            OR EXISTS (SELECT 1 FROM tags ca JOIN tag_links cl ON cl.tag_id=ca.id AND cl.target_type='tag' \
                         JOIN tags rt ON rt.id=cl.target_id \
                        WHERE rt.path=?1 AND (t.path=ca.path OR substr(t.path,1,length(ca.path)+1)=ca.path||'/'))";
    let mut st = c.prepare(sql).unwrap();
    let mut v: Vec<String> =
        st.query_map(params![path], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
    v.sort();
    v
}

/// 新谓词命中集(生产查询路径)
fn new_relation_hits(c: &Connection, path: &str) -> Vec<String> {
    let cond = FilterConditions { relations: vec![RelationCond { path: path.into() }], ..empty() };
    let mut v: Vec<String> = query(c, &cond, 0).unwrap().into_iter().map(|n| n.content).collect();
    v.sort();
    v
}

#[test]
fn relation_hits_identical_before_and_after_migration_022() {
    let mut c = db();
    create_plain(&mut c, "认领本级 #中国").unwrap();
    create_plain(&mut c, "认领子级 #中国/北京").unwrap();
    create_plain(&mut c, "经携带 #作者/丸尾").unwrap();
    create_plain(&mut c, "无关 #书").unwrap();
    let guo = ensure_path(&c, &["地点轴".into(), "国籍".into()]).unwrap();
    let china = ensure_path(&c, &["中国".into()]).unwrap();
    let author = c
        .query_row("SELECT id FROM tags WHERE path='作者/丸尾'", [], |r| r.get(0))
        .unwrap();
    c.execute(
        "INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(?1, 'type', ?2)",
        params![china, guo],
    )
    .unwrap();
    set_tag_relation(&mut c, author, guo, "").unwrap(); // 携带侧:'tag' 行

    let before = old_relation_hits(&c, "地点轴/国籍");
    assert_eq!(before, vec!["经携带", "认领子级", "认领本级"], "改前读数");

    // 迁移 022 的两条动作(与 SQL 文件逐字一致):'type' 边并入 'tag',再清 'type'
    c.execute(
        "INSERT OR IGNORE INTO tag_links(tag_id, target_type, target_id)
         SELECT tag_id, 'tag', target_id FROM tag_links WHERE target_type = 'type'",
        [],
    )
    .unwrap();
    c.execute("DELETE FROM tag_links WHERE target_type = 'type'", []).unwrap();

    let after = new_relation_hits(&c, "地点轴/国籍");
    assert_eq!(after, before, "改前改后命中集必须逐值相同");
    assert_eq!(
        c.query_row("SELECT COUNT(*) FROM tag_links WHERE target_type='type'", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
}

/// 单条件查询的真实命中正文(按正文升序)
fn hits(c: &Connection, cond: &FilterConditions) -> Vec<String> {
    let mut v: Vec<String> = query(c, cond, 0).unwrap().into_iter().map(|n| n.content).collect();
    v.sort();
    v
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", params![path], |r| r.get(0)).unwrap()
}

/// 字段改名不改语义(设计 2026-10-06 §10 R10b):同一份条件分别写成新字段名 `relations`
/// 与旧字段名(`types` 与更早的 `roles`),解析后的 WHERE 片段、参数向量与命中集都必须逐值相同。
#[test]
fn field_rename_preserves_where_clause_and_hits() {
    let mut c = db();
    create_plain(&mut c, "认领本级 #中国").unwrap();
    create_plain(&mut c, "认领子级 #中国/北京").unwrap();
    create_plain(&mut c, "经携带 #作者/丸尾").unwrap();
    create_plain(&mut c, "无关 #书").unwrap();
    let guo = ensure_path(&c, &["国籍".into()]).unwrap();
    let china = ensure_path(&c, &["中国".into()]).unwrap();
    let author = id_at(&c, "作者/丸尾");
    set_tag_relation(&mut c, china, guo, "").unwrap();
    set_tag_relation(&mut c, author, guo, "").unwrap();

    for (new_json, old_json) in [
        (r#"{"relations":[{"path":"国籍"}]}"#, r#"{"types":[{"path":"国籍"}]}"#),
        (r#"{"excludeRelations":[{"path":"国籍"}]}"#, r#"{"excludeTypes":[{"path":"国籍"}]}"#),
        (r#"{"relations":[{"path":"国籍"}]}"#, r#"{"roles":[{"path":"国籍"}]}"#),
    ] {
        let new_cond: FilterConditions = serde_json::from_str(new_json).unwrap();
        let old_cond: FilterConditions = serde_json::from_str(old_json).unwrap();
        assert_eq!(
            where_clause(&new_cond).unwrap(),
            where_clause(&old_cond).unwrap(),
            "新/旧字段名的 WHERE 片段与参数必须逐值相同"
        );
        assert_eq!(hits(&c, &new_cond), hits(&c, &old_cond), "命中集必须逐值相同");
    }
    let inc: FilterConditions = serde_json::from_str(r#"{"relations":[{"path":"国籍"}]}"#).unwrap();
    let exc: FilterConditions = serde_json::from_str(r#"{"excludeRelations":[{"path":"国籍"}]}"#).unwrap();
    assert_eq!(hits(&c, &inc), vec!["经携带", "认领子级", "认领本级"]);
    assert_eq!(hits(&c, &exc), vec!["无关"], "排除侧是补集,无黑洞");
}
