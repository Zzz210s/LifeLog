//! Task 2 筛选口径(spec 2026-10-05 §5):筛标签 T 时,一条笔记命中当且仅当它挂着某个标签 X,
//! X 满足:等式本级 / 是 T 的后代(含子级模式)/ **X 落在某个「携带 T 的标签」的子树内**(S1,
//! 两种模式共用)。排除侧走同一套命中集(无黑洞);侧栏计数不算携带。
//! 本文件只碰内存库(真实库只读)。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes::{create_plain, notes_filter::*, query};
use crate::db::repos::tags::{counts, ensure_path, set_carry};
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn tag(path: &str, include_children: bool) -> TagCond {
    TagCond { path: path.into(), include_children }
}

fn tag_id(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", params![path], |r| r.get(0)).unwrap()
}

/// 命中笔记的正文(排序无关:按正文升序,免得依赖 id 方向)
fn hits(c: &Connection, cond: &FilterConditions) -> Vec<String> {
    let mut v: Vec<String> = query(c, cond, 0).unwrap().into_iter().map(|n| n.content).collect();
    v.sort();
    v
}

fn include(path: &str, children: bool) -> FilterConditions {
    FilterConditions { tags: vec![tag(path, children)], ..empty() }
}

fn exclude(path: &str, children: bool) -> FilterConditions {
    FilterConditions { exclude_tags: vec![tag(path, children)], ..empty() }
}

/// ① 携带把命中面撑大:挂「携带者」子树的笔记,筛被携带标签时也命中;两种模式都成立。
#[test]
fn carry_broadens_hits_in_both_modes() {
    let mut c = db();
    create_plain(&mut c, "作者页 #作者/丸尾").unwrap();
    create_plain(&mut c, "无关 #书").unwrap();
    let japan = ensure_path(&c, &["地点/国籍/日本".into()]).unwrap();
    let author = tag_id(&c, "作者/丸尾");
    set_carry(&mut c, author, japan).unwrap();

    // 含子级 / 仅本级:两种模式的命中集都必须含「作者页」(携带与 self_only 无关)
    for children in [false, true] {
        assert_eq!(hits(&c, &include("地点/国籍/日本", children)), vec!["作者页"], "children={children}");
    }
    // 携带只对「被携带的那条路径」生效:筛它的祖先不会因它而撑大(不向上传播)
    assert_eq!(hits(&c, &include("地点", true)), Vec::<String>::new());
}

/// ② 沿携带者子树向下继承(S1):携带者本身与它的全部后代都参与命中。
#[test]
fn carry_inherits_down_carrier_subtree() {
    let mut c = db();
    create_plain(&mut c, "携带者本级 #作者").unwrap();
    create_plain(&mut c, "携带者后代 #作者/丸尾/作品").unwrap();
    create_plain(&mut c, "旁人 #读者").unwrap();
    let japan = ensure_path(&c, &["地点/国籍/日本".into()]).unwrap();
    let author = tag_id(&c, "作者");
    set_carry(&mut c, author, japan).unwrap();

    assert_eq!(hits(&c, &include("地点/国籍/日本", true)), vec!["携带者后代", "携带者本级"]);
}

/// ③ 只认被携带的那条路径:携带者携带日本,不代表它携带法国。
#[test]
fn carry_matches_only_the_carried_path() {
    let mut c = db();
    create_plain(&mut c, "作者页 #作者/丸尾").unwrap();
    let japan = ensure_path(&c, &["地点/国籍/日本".into()]).unwrap();
    ensure_path(&c, &["地点/国籍/法国".into()]).unwrap();
    let author = tag_id(&c, "作者/丸尾");
    set_carry(&mut c, author, japan).unwrap();

    assert_eq!(hits(&c, &include("地点/国籍/法国", true)), Vec::<String>::new());
}

/// ④ 仅本级模式不得误命中 T 的直系后代,但携带子树照样进(两条规则相互独立)。
#[test]
fn self_only_excludes_direct_descendants_but_keeps_carry() {
    let mut c = db();
    create_plain(&mut c, "直系子 #工作/项目").unwrap();
    create_plain(&mut c, "经携带 #别名甲/子").unwrap();
    let work = ensure_path(&c, &["工作".into()]).unwrap();
    let alias = ensure_path(&c, &["别名甲".into()]).unwrap();
    set_carry(&mut c, alias, work).unwrap();

    // 仅本级:直系子被排除,经携带的命中
    assert_eq!(hits(&c, &include("工作", false)), vec!["经携带"]);
    // 含子级:两条都命中
    assert_eq!(hits(&c, &include("工作", true)), vec!["直系子", "经携带"]);
}

/// ⑤ 排除侧走同一套命中集:含/排除互补,不存在"既不包含也不排除"的黑洞。
#[test]
fn exclude_side_shares_carry_hits_and_is_complementary() {
    let mut c = db();
    create_plain(&mut c, "作者页 #作者/丸尾").unwrap();
    create_plain(&mut c, "无关 #书").unwrap();
    let japan = ensure_path(&c, &["地点/国籍/日本".into()]).unwrap();
    let author = tag_id(&c, "作者/丸尾");
    set_carry(&mut c, author, japan).unwrap();

    for children in [false, true] {
        let inc = hits(&c, &include("地点/国籍/日本", children));
        let exc = hits(&c, &exclude("地点/国籍/日本", children));
        assert_eq!(inc, vec!["作者页"], "引入侧 children={children}");
        assert_eq!(exc, vec!["无关"], "排除侧 children={children}");
        assert!(inc.iter().all(|x| !exc.contains(x)), "两侧不相交");
    }
}

/// ⑥ 携带不进侧栏计数:加携带前后 `counts()` 的每一项逐值不变(R1 口径,结构事实)。
#[test]
fn sidebar_counts_ignore_carry() {
    let mut c = db();
    create_plain(&mut c, "笔记一 #地点/国籍/日本").unwrap();
    create_plain(&mut c, "笔记二 #作者/丸尾").unwrap();
    create_plain(&mut c, "笔记三 #作者/丸尾/作品").unwrap();
    let before = counts(&c).unwrap();

    let japan = tag_id(&c, "地点/国籍/日本");
    let author = tag_id(&c, "作者/丸尾");
    set_carry(&mut c, author, japan).unwrap();
    assert_eq!(tag_id(&c, "地点/国籍/日本"), japan, "携带不动标签 id");

    let after = counts(&c).unwrap();
    assert_eq!(before.len(), after.len(), "标签行数不变");
    for (b, a) in before.iter().zip(after.iter()) {
        assert_eq!((b.id, &b.path), (a.id, &a.path), "同一标签行");
        assert_eq!(b.self_count, a.self_count, "{} 本级计数不变", b.path);
        assert_eq!(b.subtree_count, a.subtree_count, "{} 含子级计数不变", b.path);
    }
}
