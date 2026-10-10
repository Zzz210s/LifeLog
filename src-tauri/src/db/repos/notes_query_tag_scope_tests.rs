//! 读侧收口(2026-10-10):标签 / 关系条件只命**树外实体(笔记)**。
//! 一条 `link` 边在库里承载三种语义(笔记挂标签 / 标签间关系 / 笔记间链接),靠两端是否
//! 树内区分;`A --(remark)---> B` 是「关系」,不是「A 挂在自己身上」。不限定 `n.path IS NULL`
//! 时,标签 A/B 自己会被算进信息流、导出与条件栏计数(预演实测 地点轴/所在 +10、状态/已完成 +7)。
//! 本文件只碰内存库(真实库只读)。结构化条件与表达式逃生舱(`Expr`)同口径:
//! 表达式里含标签叶子时按同一 "只命笔记" 收窄(见 `expr::compile_for_filter`)。
use crate::db::migrate;
use crate::db::repos::notes::create_plain;
use crate::db::repos::notes::notes_filter::*;
use crate::db::repos::notes::query;
use crate::db::repos::notes_hits;
use crate::db::repos::settings::{self, FILTER_CURRENT_KEY};
use crate::db::repos::tags::{ensure_path, set_tag_relation};
use crate::exchange::notes_export;
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn tag(path: &str) -> FilterConditions {
    FilterConditions { tags: vec![TagCond { path: path.into(), include_children: true }], ..empty() }
}

fn relation(path: &str) -> FilterConditions {
    FilterConditions { relations: vec![RelationCond { path: path.into() }], ..empty() }
}

/// 信息流命中行的 id(升序,便于逐值断言)
fn hit_ids(c: &Connection, cond: &FilterConditions) -> Vec<i64> {
    let mut v: Vec<i64> = query(c, cond, 0).unwrap().into_iter().map(|n| n.id).collect();
    v.sort();
    v
}

/// 夹具:`A --(归属)--> B`、`B/sub`;笔记一只挂 `A`,笔记二只挂 `B/sub`;
/// 树内实体 `C` 又指向 `A`(让 C 能经 `A` 的携带子树命中 `B`)。
/// 建库前先落笔记(`create_plain` 末尾会回收无主标签),再补标签与关系。
/// 返回 `(库, A, B, C, 笔记挂A, 笔记挂B子)`
fn fixture() -> (Connection, i64, i64, i64, i64, i64) {
    let mut c = db();
    let n_a = create_plain(&mut c, "笔记挂 A #A").unwrap().id;
    let n_b = create_plain(&mut c, "笔记挂 B子 #B/sub").unwrap().id;
    let a = id_at(&c, "A");
    let b = id_at(&c, "B");
    let c_tag = ensure_path(&c, &["C".into()]).unwrap();
    set_tag_relation(&mut c, a, b, "归属").unwrap();
    set_tag_relation(&mut c, c_tag, a, "关系").unwrap();
    (c, a, b, c_tag, n_a, n_b)
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM entities WHERE path=?1", [path], |r| r.get(0)).unwrap()
}

/// ① 筛 `B`:挂 A 的笔记经 carry 命中、挂 B/sub 的经含子级命中;
/// A/B/C 这三个树内实体自己都不进命中集。
#[test]
fn tag_filter_hits_notes_only_not_the_tag_entities() {
    let (c, a, b, c_tag, n_a, n_b) = fixture();
    let ids = hit_ids(&c, &tag("B"));
    assert_eq!(ids, vec![n_a, n_b], "两条笔记都在,且只剩笔记");
    for leaked in [a, b, c_tag] {
        assert!(!ids.contains(&leaked), "树内实体 {leaked} 不得成为命中行");
    }
}

/// ② 条件栏「命中 N 条」== 信息流真查出来的条数(含排除项正形式)
#[test]
fn condition_hits_count_equals_stream_rows() {
    let (c, ..) = fixture();
    for cond in [tag("B"), relation("B")] {
        let stream = hit_ids(&c, &cond);
        let reported = notes_hits::hits(&c, &cond).unwrap().groups[0].item_hits[0];
        assert_eq!(reported as usize, stream.len(), "读数必须与流一致");
    }
}

/// ③ 导出行集 == 当前筛选命中集(导出读同一份 `where_clause`)
#[test]
fn export_rows_equal_filter_hits() {
    let (c, _a, _b, _c_tag, n_a, n_b) = fixture();
    let cond = tag("B");
    settings::set(&c, FILTER_CURRENT_KEY, &serde_json::to_string(&cond).unwrap()).unwrap();
    let mut ids: Vec<i64> = notes_export::rows(&c).unwrap().into_iter().map(|r| r.id).collect();
    ids.sort();
    assert_eq!(ids, vec![n_a, n_b], "导出与信息流逐值一致");
    assert_eq!(ids, hit_ids(&c, &cond), "导出 == 命中集");
}

/// ④ 回归:树内实体即便自己带正文(多行),也不能经 `C -> A -> B` 的关系链冒出来
#[test]
fn relation_filter_does_not_pull_in_tree_entities_with_content() {
    let (c, _a, _b, c_tag, n_a, _n_b) = fixture();
    c.execute("UPDATE entities SET meta='C\n第二行' WHERE id=?1", [c_tag]).unwrap();
    let ids = hit_ids(&c, &relation("B"));
    assert_eq!(ids, vec![n_a], "只有笔记经 A 子树命中 B");
    assert!(!ids.contains(&c_tag), "带正文的树内实体不得经关系边冒出来");
}

/// ⑤ 表达式逃生舱同口径:`#B` 与结构化筛 `B` 逐值一致,树内实体不得冒出来
#[test]
fn expr_tag_filter_matches_structured_and_hits_notes_only() {
    let (c, a, b, c_tag, n_a, n_b) = fixture();
    let expr = FilterConditions { expr: Some("#B".into()), ..empty() };
    assert_eq!(hit_ids(&c, &expr), hit_ids(&c, &tag("B")), "表达式与结构化逐值一致");
    assert_eq!(hit_ids(&c, &expr), vec![n_a, n_b]);
    for leaked in [a, b, c_tag] {
        assert!(!hit_ids(&c, &expr).contains(&leaked), "树内实体 {leaked} 不得出现");
    }
}

/// ⑥ 纯关键词表达式不收窄(与结构化 Keyword 一致):带正文的树内实体照旧命中
#[test]
fn keyword_only_expr_is_not_narrowed_to_notes() {
    let (c, _a, _b, c_tag, _n_a, _n_b) = fixture();
    c.execute("UPDATE entities SET meta='关键词C\n第二行' WHERE id=?1", [c_tag]).unwrap();
    let expr = FilterConditions { expr: Some("\"第二\"".into()), ..empty() };
    assert_eq!(hit_ids(&c, &expr), vec![c_tag], "纯关键词表达式保持原域");
}
