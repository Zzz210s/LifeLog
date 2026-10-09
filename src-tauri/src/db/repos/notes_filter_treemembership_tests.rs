//! T2.3 两个新筛选条件种类的语义用例(spec §4.1 / §10-P2):
//! `treeMembership` 按**闭包**判定(不是裸 `is_cited` 列),`singleLine` 按 `meta` 是否含换行;
//! 028 预置的默认筛选字面量能被 `FilterConditions` 反序列化,结果等于「树外实体集合」。
use super::notes_filter::{validate, where_clause, FilterConditions};
use rusqlite::{params_from_iter, Connection};

/// 028 迁移预置的默认筛选字面量(逐字抄自 `migration_hooks::unify_meta::DEFAULT_FILTER_JSON`)。
const PRESET: &str = concat!(
    r#"{"keyword":null,"tags":[],"excludeTags":[],"relations":[],"excludeRelations":[],"#,
    r#""tagPresence":null,"sort":null,"sorts":[],"groupBy":null,"expr":null,"groupOp":"and","#,
    r#""groups":[{"op":"or","items":[{"kind":"treeMembership","value":"out"},"#,
    r#"{"kind":"singleLine","value":"multi"}]}]}"#,
);

/// 闭包夹具:1(根) -> 2(中) -> 3(叶,被 12 引用);10/11/12 是树外实体。
/// `is_cited` 只有 3 为 1,但闭包经 `child` 向上补回 1 与 2 —— 这正是「闭包 ≠ 裸 is_cited」。
fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    crate::db::migrate::run(&c).unwrap();
    c.execute_batch(
        "INSERT INTO entities(id,meta,is_cited,created_at,path,depth,parent_id) VALUES
           (1,'甲',0,'2026-01-01','甲',1,NULL),
           (2,'中',0,'2026-01-01','甲/中',2,1),
           (3,'叶',1,'2026-01-01','甲/中/叶',3,2),
           (10,'单行笔记',0,'2026-01-02',NULL,NULL,NULL),
           (11,'多行' || char(10) || '第二行',0,'2026-01-03',NULL,NULL,NULL),
           (12,'引用叶',0,'2026-01-04',NULL,NULL,NULL);
         INSERT INTO edges(source_id,target_id,kind,created_at) VALUES
           (1,2,'child','2026-01-01'),(2,3,'child','2026-01-01'),
           (12,3,'link','2026-01-04');",
    )
    .unwrap();
    c
}

/// 单个条件种类(单组 op='and')的命中 id 集,升序
fn hits(c: &Connection, item: &str) -> Vec<i64> {
    let json = format!(r#"{{"groups":[{{"op":"and","items":[{item}]}}]}}"#);
    let conds: FilterConditions = serde_json::from_str(&json).unwrap();
    let (frag, args) = where_clause(&conds).unwrap();
    let mut stmt = c
        .prepare(&format!("SELECT n.id FROM entities n WHERE ({frag}) ORDER BY n.id"))
        .unwrap();
    let rows = stmt.query_map(params_from_iter(args), |r| r.get(0)).unwrap();
    rows.map(|r| r.unwrap()).collect()
}

fn closure(c: &Connection) -> Vec<i64> {
    crate::db::repos::entities::closure::tree_closure_ids(c).unwrap()
}

#[test]
fn tree_membership_in_matches_closure_and_out_is_complement() {
    let c = db();
    assert_eq!(closure(&c), vec![1, 2, 3], "闭包 = is_cited(3) ∪ 祖先(2,1)");
    let in_hits = hits(&c, r#"{"kind":"treeMembership","value":"in"}"#);
    assert_eq!(in_hits, vec![1, 2, 3], "in == 闭包集合");
    assert_eq!(
        hits(&c, r#"{"kind":"treeMembership","value":"out"}"#),
        vec![10, 11, 12],
        "out == 补集"
    );
}

/// 反例(变异自证的目标):同一库上按裸 `is_cited` 判定时,`out` 会多出中间节点 1、2
/// (它们 `is_cited=0` 但在闭包内)。把编译从 `in_tree_predicate` 换成
/// `ENTITIES.is_cited = 0`,本用例变红。
#[test]
fn tree_membership_uses_closure_not_raw_is_cited() {
    let c = db();
    let out = hits(&c, r#"{"kind":"treeMembership","value":"out"}"#);
    assert_eq!(out, vec![10, 11, 12], "闭包口径:out = 树外实体");
    assert!(!out.contains(&1) && !out.contains(&2), "中间节点仍在树内(裸 is_cited 会漏进来)");
    let raw_is_cited_zero: Vec<i64> = {
        let mut stmt = c.prepare("SELECT id FROM entities WHERE is_cited = 0 ORDER BY id").unwrap();
        stmt.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
    };
    assert_eq!(raw_is_cited_zero, vec![1, 2, 10, 11, 12], "裸口径会把 1、2 也算进 out");
}

#[test]
fn single_line_classifies_by_newline() {
    let c = db();
    assert_eq!(
        hits(&c, r#"{"kind":"singleLine","value":"single"}"#),
        vec![1, 2, 3, 10, 12],
        "不含换行 = 单行"
    );
    assert_eq!(hits(&c, r#"{"kind":"singleLine","value":"multi"}"#), vec![11], "含换行 = 多行");
}

/// 028 预置筛选往返:JSON 能被 Rust 结构反序列化、通过校验,结果 == 树外实体集合
/// (真库口径 1373 = 迁移前 `kind='note'` 集合,spec §3.8 / §4.1)。
#[test]
fn preset_filter_roundtrips_and_equals_non_tree_entities() {
    let c = db();
    let conds: FilterConditions = serde_json::from_str(PRESET).unwrap();
    assert_eq!(conds.groups.len(), 1);
    assert_eq!(conds.groups[0].op, "or");
    assert_eq!(conds.groups[0].items.len(), 2, "两个新条件种类都被解析");
    validate(&conds).expect("预置筛选必须通过校验");
    let (frag, args) = where_clause(&conds).unwrap();
    let mut stmt = c
        .prepare(&format!("SELECT n.id FROM entities n WHERE ({frag}) ORDER BY n.id"))
        .unwrap();
    let got: Vec<i64> =
        stmt.query_map(params_from_iter(args), |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
    let expected: Vec<i64> = {
        let mut s = c.prepare("SELECT id FROM entities WHERE path IS NULL ORDER BY id").unwrap();
        s.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
    };
    assert_eq!(expected, vec![10, 11, 12], "夹具里的树外(笔记)集合");
    assert_eq!(got, expected, "预设筛选 = NOT(树内 AND 单行) == 树外集合");
}

#[test]
fn invalid_membership_or_line_values_are_rejected() {
    for item in [
        r#"{"kind":"treeMembership","value":"both"}"#,
        r#"{"kind":"singleLine","value":"nope"}"#,
    ] {
        let json = format!(r#"{{"groups":[{{"op":"and","items":[{item}]}}]}}"#);
        let conds: FilterConditions = serde_json::from_str(&json).unwrap();
        assert!(validate(&conds).is_err(), "非法取值必须被校验拦下:{item}");
    }
}
