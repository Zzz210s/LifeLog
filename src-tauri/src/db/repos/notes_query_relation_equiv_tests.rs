//! 行为等价对账(计划 Task 1 §要点 / 设计 §10 R8):同一份「认领 + 携带」数据下,
//! 生产谓词(`carry_predicate` 读 `edges(kind='relation')` 反方向)的命中集必须与
//! 手工参考 SQL(直读 `edges`/`entities`,不依赖被测代码)逐值相同。
//! 新方案下 022 的 `'type'`/`'tag'` 之分已消失(统一为 `kind='relation'`),故不再分改前/改后。
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

/// 手工参考命中集:笔记挂的标签 t 落在某个「经 relation 边指向 `path` 标签」的携带者 ca
/// 的子树内(自带或后代)—— 不引用被测量的 `filter_predicates` 代码。
fn reference_relation_hits(c: &Connection, path: &str) -> Vec<String> {
    let sql = "SELECT DISTINCT n.content FROM entities n \
         JOIN edges l ON l.kind='tagging' AND l.source_id=n.id \
         JOIN entities t ON t.id=l.target_id \
         WHERE EXISTS (SELECT 1 FROM entities ca JOIN edges cl ON cl.source_id=ca.id AND cl.kind='relation' \
                         JOIN entities rt ON rt.id=cl.target_id \
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
fn relation_hits_match_handwritten_reference_on_edges() {
    let mut c = db();
    create_plain(&mut c, "认领本级 #中国").unwrap();
    create_plain(&mut c, "认领子级 #中国/北京").unwrap();
    create_plain(&mut c, "经携带 #作者/丸尾").unwrap();
    create_plain(&mut c, "无关 #书").unwrap();
    let guo = ensure_path(&c, &["地点轴".into(), "国籍".into()]).unwrap();
    let china = ensure_path(&c, &["中国".into()]).unwrap();
    let author = id_at(&c, "作者/丸尾");
    set_tag_relation(&mut c, china, guo, "").unwrap(); // 认领侧:中国 -> 地点轴/国籍
    set_tag_relation(&mut c, author, guo, "").unwrap(); // 携带侧:作者/丸尾 -> 地点轴/国籍

    let reference = reference_relation_hits(&c, "地点轴/国籍");
    assert_eq!(reference, vec!["经携带", "认领子级", "认领本级"], "手工参考读数");
    assert_eq!(
        new_relation_hits(&c, "地点轴/国籍"),
        reference,
        "生产谓词必须与手工参考逐值相同"
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
