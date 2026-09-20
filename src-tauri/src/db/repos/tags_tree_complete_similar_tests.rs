//! 近义补全的链路测试(G4 spec §2 D8,测试先行):`complete_with_aliases` 追加 kind="similar" 的
//! 候选,排在标签/别名之后、按 path 去重(标签/别名优先)、只在候选占不满展示上限时才补、上限 4 条。
use super::similar::{SIMILAR_MAX, SIMILAR_TRIGGER};
use super::*;
use crate::db::migrate;
use crate::db::repos::{notes, tag_alias};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", [path], |r| r.get(0))
        .unwrap()
}

fn item(path: &str, kind: &str) -> CompleteItem {
    CompleteItem { path: path.to_string(), kind: kind.to_string() }
}

/// ① 前缀命中不足展示上限时补相似项:kind="similar",排在标签项之后,且不与标签项重复
#[test]
fn similar_items_appended_after_tag_items() {
    let mut c = db();
    notes::create_plain(&mut c, "a #追番/日漫 #日漫志").unwrap();
    assert_eq!(
        complete_with_aliases(&c, "日漫").unwrap(),
        vec![item("日漫志", "tag"), item("追番/日漫", "similar")],
        "前缀命中 日漫志 是标签项;叶子名与词元相同的 追番/日漫 作为近似项追加"
    );
}

/// ② 已作为别名返回的路径不再作为相似项重复出现(标签/别名优先)
#[test]
fn similar_does_not_duplicate_alias_path() {
    let mut c = db();
    notes::create_plain(&mut c, "看番 #追番/日漫").unwrap();
    let target = id_at(&c, "追番/日漫");
    tag_alias::add(&c, "日漫", target).unwrap();

    assert_eq!(
        complete_with_aliases(&c, "日漫").unwrap(),
        vec![item("追番/日漫", "alias")],
        "别名项已占用该 path,相似项不得再来一条"
    );
}

/// ③ 标签 + 别名候选占满前端展示上限(8 条)时不补相似项
#[test]
fn no_similar_items_when_candidates_fill_display_limit() {
    let mut c = db();
    for i in 0..SIMILAR_TRIGGER {
        notes::create_plain(&mut c, &format!("n{i} #标签{i:02}")).unwrap();
    }
    // 近似候选:叶子含词元但路径不以词元开头(不会成为前缀命中项)
    notes::create_plain(&mut c, "m #工作/标签法").unwrap();

    let rows = complete_with_aliases(&c, "标签").unwrap();
    assert_eq!(rows.len(), SIMILAR_TRIGGER, "8 个前缀命中项");
    assert!(rows.iter().all(|i| i.kind == "tag"), "占满展示上限时不追加相似项");
}

/// ④ 相似项上限 SIMILAR_MAX:无前缀命中时最多补 4 条,按路径升序
#[test]
fn similar_items_capped_at_max() {
    let mut c = db();
    for ch in ["A", "B", "C", "D", "E"] {
        notes::create_plain(&mut c, &format!("n{ch} #父/日漫{ch}")).unwrap();
    }
    let rows = complete_with_aliases(&c, "日漫").unwrap();
    assert_eq!(rows.len(), SIMILAR_MAX);
    assert!(rows.iter().all(|i| i.kind == "similar"));
    assert_eq!(
        rows.iter().map(|i| i.path.as_str()).collect::<Vec<_>>(),
        vec!["父/日漫A", "父/日漫B", "父/日漫C", "父/日漫D"]
    );
}

/// ⑤ 空词元(刚敲下 #)只有标签项,不产生相似项
#[test]
fn empty_prefix_has_no_similar_items() {
    let mut c = db();
    notes::create_plain(&mut c, "a #追番/日漫 #日漫志").unwrap();
    let rows = complete_with_aliases(&c, "").unwrap();
    assert!(!rows.is_empty());
    assert!(rows.iter().all(|i| i.kind == "tag"));
}
