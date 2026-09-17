//! 同级插入(S8)的持久化与追加语义:重复执行稳定、move_to 追加到末层末尾、
//! 锚点缺失时按追加处理、counts 暴露的 sort_order 与写入一致。
use super::order_support::{dump, id_at, orders, seed, siblings, db};
use super::ops::move_to_ordered;
use super::*;

#[test]
fn repeated_move_beside_is_stable() {
    let mut c = db();
    seed(&mut c, "x #a #b #c");
    let (a, ctag) = (id_at(&c, "a"), id_at(&c, "c"));

    move_beside(&mut c, ctag, a, false).unwrap();
    let first = dump(&c);
    move_beside(&mut c, ctag, a, false).unwrap();

    assert_eq!(dump(&c), first, "同样落点重复执行结果不变");
    assert_eq!(siblings(&c, None), vec!["c", "a", "b"]);
}

#[test]
fn move_to_appends_to_the_end_of_the_new_layer() {
    let mut c = db();
    seed(&mut c, "x #a #b #c #工作/项目A");
    let leaf = id_at(&c, "工作/项目A");

    move_to(&mut c, leaf, None).unwrap();

    assert_eq!(siblings(&c, None), vec!["a", "b", "c", "项目A"]);
}

#[test]
fn move_to_ordered_appends_when_anchor_missing() {
    let mut c = db();
    seed(&mut c, "x #a #b");
    let a = id_at(&c, "a");
    // 锚点 id 不在兄弟列表(不存在的 id)-> 按追加处理,并整层重编号
    let ghost = super::ops_sql::Anchor { id: 9999, after: false };

    move_to_ordered(&mut c, a, None, Some(ghost)).unwrap();

    assert_eq!(siblings(&c, None), vec!["b", "a"]);
    assert_eq!(orders(&c, None), vec![0, 1]);
}

#[test]
fn counts_exposes_sort_order_matching_the_written_order() {
    let mut c = db();
    seed(&mut c, "x #a #b #c");
    let (a, ctag) = (id_at(&c, "a"), id_at(&c, "c"));
    move_beside(&mut c, ctag, a, false).unwrap();

    let rows = counts(&c).unwrap();
    let mut ordered: Vec<(i64, String)> = rows
        .iter()
        .filter(|r| r.depth == 1)
        .map(|r| (r.sort_order, r.path.clone()))
        .collect();
    ordered.sort();
    assert_eq!(ordered, vec![(0, "c".into()), (1, "a".into()), (2, "b".into())]);
    // 扁平返回仍是路径序(前端扁平模式与补全依赖它)
    let paths: Vec<&str> = rows.iter().map(|r| r.path.as_str()).collect();
    assert_eq!(paths, vec!["a", "b", "c"]);
}
