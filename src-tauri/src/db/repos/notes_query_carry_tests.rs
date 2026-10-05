//! Task 2 筛选口径(spec 2026-10-05 §5):筛标签 T 时,一条笔记命中当且仅当它挂着某个标签 X,
//! X 满足:等式本级 / 是 T 的后代(含子级模式)/ **X 落在某个「携带 T 的标签」的子树内**(S1,
//! 两种模式共用)。排除侧走同一套命中集(无黑洞);侧栏计数不算携带。
//! 本文件只碰内存库(真实库只读)。
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

/// ⑦ 大库形态等价性:3 个携带者 × 各自一棵深子树 + 同前缀无 `/` 边界的干扰标签,
/// 查询命中的笔记集合必须与暴力枚举「携带者子树向下继承」逐值一致。优化把相关
/// EXISTS 换成一次物化的标签 id 集合,这条用例防物化集合漏成员或多成员。
#[test]
fn large_tree_matches_brute_force_carry_expansion() {
    let mut c = db();
    let carried = "地点轴/国籍/日本";
    let japan = ensure_path(&c, &["地点轴".into(), "国籍".into(), "日本".into()]).unwrap();
    let carriers = ["作者/A", "作者/B", "系列/X"];
    // (正文, 标签路径, 是否应命中)
    let mut cases: Vec<(String, String, bool)> = Vec::new();
    let add = |c: &mut Connection, cases: &mut Vec<(String, String, bool)>, tag: &str, hit: bool| {
        let label = format!("L{}", cases.len());
        create_plain(c, &format!("{label} #{tag}")).unwrap();
        cases.push((label, tag.into(), hit));
    };
    add(&mut c, &mut cases, carried, true);
    add(&mut c, &mut cases, "地点轴/国籍/日本/子", true);
    add(&mut c, &mut cases, "书", false);
    for name in carriers {
        let carrier = ensure_path(&c, &name.split('/').map(Into::into).collect::<Vec<_>>()).unwrap();
        set_carry(&mut c, carrier, japan).unwrap();
        add(&mut c, &mut cases, name, true);
        for d in 0..12 {
            add(&mut c, &mut cases, &format!("{name}/层{d}"), true);
        }
        // 同前缀陷阱:与携带者路径同名开头但下一字符不是 `/`
        add(&mut c, &mut cases, &format!("{name}尾巴"), false);
    }
    // 携带者的祖先也不匹配(携带只向下、不向上)
    add(&mut c, &mut cases, "作者", false);
    // 深链:携带者子孙的子孙仍命中
    add(&mut c, &mut cases, "作者/A/层0/更/深", true);

    let mut expected: Vec<String> =
        cases.iter().filter(|(_, _, hit)| *hit).map(|(l, _, _)| l.clone()).collect();
    expected.sort();
    assert_eq!(hits(&c, &include(carried, true)), expected, "大库形态命中集必须与暴力枚举一致");
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
