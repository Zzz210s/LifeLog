//! 同级插入(S8):move_beside 的三种落点语义与拒绝路径。
//! 口径:兄弟序 = (sort_order, path);插到锚点前/后后整层重写 0..n-1,
//! 未动的兄弟相对次序不变;锚点=自身无操作;环检测与深度上限沿用 move_to。
use super::order_support::{dump, id_at, orders, seed, siblings, db};
use super::*;

#[test]
fn move_beside_before_places_tag_before_anchor() {
    let mut c = db();
    seed(&mut c, "x #a #b #c");
    let (a, ctag) = (id_at(&c, "a"), id_at(&c, "c"));
    // 初始:siblings 默认 sort_order 0,按 path 序 a/b/c
    assert_eq!(siblings(&c, None), vec!["a", "b", "c"]);

    move_beside(&mut c, ctag, a, false).unwrap();

    assert_eq!(siblings(&c, None), vec!["c", "a", "b"]);
    assert_eq!(orders(&c, None), vec![0, 1, 2], "sort_order 应重写为 0..n-1");
}

#[test]
fn move_beside_after_places_tag_after_anchor() {
    let mut c = db();
    seed(&mut c, "x #a #b #c");
    let (a, b) = (id_at(&c, "a"), id_at(&c, "b"));

    move_beside(&mut c, a, b, true).unwrap();

    assert_eq!(siblings(&c, None), vec!["b", "a", "c"]);
    assert_eq!(orders(&c, None), vec![0, 1, 2]);
}

#[test]
fn move_beside_keeps_untouched_siblings_relative_order() {
    let mut c = db();
    seed(&mut c, "x #a #b #c #d");
    let (b, d) = (id_at(&c, "b"), id_at(&c, "d"));

    move_beside(&mut c, d, b, false).unwrap();

    // a 与 c 未参与,相对次序仍是 a < c
    assert_eq!(siblings(&c, None), vec!["a", "d", "b", "c"]);
}

#[test]
fn move_beside_across_parents_becomes_sibling_of_anchor() {
    let mut c = db();
    seed(&mut c, "x #工作/项目A #生活/健身");
    let leaf = id_at(&c, "工作/项目A");
    let anchor = id_at(&c, "生活/健身");
    let life = id_at(&c, "生活");

    move_beside(&mut c, leaf, anchor, true).unwrap();

    assert_eq!(siblings(&c, Some(life)), vec!["生活/健身", "生活/项目A"]);
    let depth: i64 = c
        .query_row("SELECT depth FROM tags WHERE id=?1", [leaf], |r| r.get(0))
        .unwrap();
    assert_eq!(depth, 2, "跨层后深度随新父级重算");
    // 旧父级「工作」已无链接无子节点,被回收
    let left = c
        .query_row("SELECT COUNT(*) FROM tags WHERE path='工作'", [], |r| r.get::<_, i64>(0))
        .unwrap();
    assert_eq!(left, 0);
}

#[test]
fn move_beside_self_is_a_noop() {
    let mut c = db();
    seed(&mut c, "x #a #b #c");
    let b = id_at(&c, "b");
    let before = dump(&c);

    move_beside(&mut c, b, b, false).unwrap();
    move_beside(&mut c, b, b, true).unwrap();

    assert_eq!(dump(&c), before, "拖到自己前面/后面必须无操作");
    assert_eq!(siblings(&c, None), vec!["a", "b", "c"]);
}

#[test]
fn move_beside_rejects_own_subtree() {
    let mut c = db();
    seed(&mut c, "x #工作/项目A");
    let work = id_at(&c, "工作");
    let child = id_at(&c, "工作/项目A");
    let before = dump(&c);

    // 锚点是自己的子标签 -> 新父级就是自己 -> 环检测拒绝
    assert!(move_beside(&mut c, work, child, false).is_err());
    assert_eq!(dump(&c), before, "环检测失败必须整库回滚");
}
