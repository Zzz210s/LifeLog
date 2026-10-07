//! 关系筛选口径(设计 2026-10-06 §4 R4):筛关系 R 时,一条笔记命中当且仅当它挂着
//! 某个标签 X,而 X 落在「指向 R 的标签」子树内,或落在「携带 R 的标签」子树内 ——
//! 指向那一跳与标签条件共用同一套子树继承。排除侧走同一份命中集(无黑洞)。
//! 夹具开 foreign_keys=ON(与 db::open 一致):级联/回收是真的。本文件只碰内存库(真实库只读)。
use crate::db::migrate;
use crate::db::repos::notes::{create_plain, notes_filter::*, query};
use crate::db::repos::tags::{ensure_path, set_tag_relation};
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    crate::db::repos::tags::test_support::install_entity_views(&c);
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    c
}

fn relation_cond(path: &str) -> RelationCond {
    RelationCond { path: path.into() }
}

fn include(path: &str) -> FilterConditions {
    FilterConditions { relations: vec![relation_cond(path)], ..empty() }
}

fn exclude(path: &str) -> FilterConditions {
    FilterConditions { exclude_relations: vec![relation_cond(path)], ..empty() }
}

/// 命中笔记的正文(按正文升序,免得依赖 id 方向)
fn hits(c: &Connection, cond: &FilterConditions) -> Vec<String> {
    let mut v: Vec<String> = query(c, cond, 0).unwrap().into_iter().map(|n| n.content).collect();
    v.sort();
    v
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", params![path], |r| r.get(0)).unwrap()
}

/// ① 类型命中 = 被认领标签的子树 ∪ 携带该类型的标签子树;认领与携带两条腿都生效
#[test]
fn relation_hits_claimed_subtree_and_carriers() {
    let mut c = db();
    create_plain(&mut c, "认领本级 #中国").unwrap();
    create_plain(&mut c, "认领子级 #中国/北京").unwrap();
    create_plain(&mut c, "经携带 #作者/丸尾").unwrap();
    create_plain(&mut c, "无关 #书").unwrap();
    let guo = ensure_path(&c, &["地点轴".into(), "国籍".into()]).unwrap();
    let china = ensure_path(&c, &["中国".into()]).unwrap();
    let author = id_at(&c, "作者/丸尾");
    set_tag_relation(&mut c, china, guo, "").unwrap();
    set_tag_relation(&mut c, author, guo, "").unwrap();

    assert_eq!(hits(&c, &include("地点轴/国籍")), vec!["经携带", "认领子级", "认领本级"]);
}

/// ② 携带只对当前类型生效:携带国籍不等于携带所在(不串味、不向上传播)
#[test]
fn type_carry_matches_only_this_type() {
    let mut c = db();
    create_plain(&mut c, "作者页 #作者/丸尾").unwrap();
    let guo = ensure_path(&c, &["国籍".into()]).unwrap();
    let author = id_at(&c, "作者/丸尾");
    set_tag_relation(&mut c, author, guo, "").unwrap();

    assert_eq!(hits(&c, &include("国籍")), vec!["作者页"]);
    assert_eq!(hits(&c, &include("所在")), Vec::<String>::new(), "别的类型不受这条携带影响");
    assert_eq!(hits(&c, &include("地点轴")), Vec::<String>::new(), "只认该类型本身,不认它的祖先");
}

/// ③ 含/排除互补:两侧共用同一份命中集,不存在"既不包含也不排除"的黑洞
#[test]
fn type_exclude_is_complementary() {
    let mut c = db();
    create_plain(&mut c, "认领本级 #中国").unwrap();
    create_plain(&mut c, "经携带 #作者/丸尾").unwrap();
    create_plain(&mut c, "无关 #书").unwrap();
    let guo = ensure_path(&c, &["国籍".into()]).unwrap();
    let china = ensure_path(&c, &["中国".into()]).unwrap();
    let author = id_at(&c, "作者/丸尾");
    set_tag_relation(&mut c, china, guo, "").unwrap();
    set_tag_relation(&mut c, author, guo, "").unwrap();

    let inc = hits(&c, &include("国籍"));
    let exc = hits(&c, &exclude("国籍"));
    assert_eq!(inc, vec!["经携带", "认领本级"]);
    assert_eq!(exc, vec!["无关"]);
    assert!(inc.iter().all(|x| !exc.contains(x)), "两侧不相交");
}

/// ④ 类型没认领任何标签(也没有携带者)时命中 0,不是"退化成全部"
#[test]
fn type_without_claims_hits_nothing() {
    let mut c = db();
    create_plain(&mut c, "甲 #中国").unwrap();
    create_plain(&mut c, "乙 #书").unwrap();
    ensure_path(&c, &["国籍".into()]).unwrap(); // 标签存在,但一条指向它的边都没有

    assert_eq!(hits(&c, &include("国籍")), Vec::<String>::new());
    assert_eq!(hits(&c, &exclude("国籍")), vec!["乙", "甲"], "排除无认领类型 = 全库");
}

/// ⑤ 只被认领、还没有笔记的标签不被孤儿回收(与 R2 同款):回收会让类型筛选静默漏人。
/// 夹具走真实写入路径(create_plain 末尾会跑 gc_orphans),不是直接调 gc。
#[test]
fn claimed_tag_survives_gc_and_stays_filterable() {
    let mut c = db();
    let guo = ensure_path(&c, &["国籍".into()]).unwrap();
    let japan = ensure_path(&c, &["日本".into()]).unwrap();
    set_tag_relation(&mut c, japan, guo, "").unwrap();

    create_plain(&mut c, "无关 #书").unwrap(); // 触发 gc_orphans
    assert_eq!(id_at(&c, "日本"), japan, "被认领的标签不得被回收");
    assert_eq!(hits(&c, &include("国籍")), Vec::<String>::new(), "还没有笔记 -> 命中 0");

    create_plain(&mut c, "后来 #日本").unwrap();
    assert_eq!(hits(&c, &include("国籍")), vec!["后来"], "认领仍在,后挂上的笔记能筛到");
}

/// ⑥ 子树边界:同前缀无 `/` 的干扰标签不命中;深链子孙命中;携带者祖先不命中
#[test]
fn type_subtree_boundary_and_deep_chain() {
    let mut c = db();
    create_plain(&mut c, "子 #中国/北京").unwrap();
    create_plain(&mut c, "深 #中国/北京/海淀/中关村/一路").unwrap();
    create_plain(&mut c, "同前缀干扰 #中国X").unwrap();
    create_plain(&mut c, "携带者祖先后代 #作者/丸尾/作品").unwrap();
    create_plain(&mut c, "携带者祖先 #作者").unwrap();
    let guo = ensure_path(&c, &["国籍".into()]).unwrap();
    let china = ensure_path(&c, &["中国".into()]).unwrap();
    let author = id_at(&c, "作者/丸尾");
    set_tag_relation(&mut c, china, guo, "").unwrap();
    set_tag_relation(&mut c, author, guo, "").unwrap();

    assert_eq!(
        hits(&c, &include("国籍")),
        vec!["子", "携带者祖先后代", "深"],
        "同前缀干扰与携带者祖先都不得命中"
    );
}

/// ⑦ 大库形态等价性:多类型 × 多认领 × 各自子树 + 携带者,命中集必须与暴力枚举逐值一致。
/// 物化 id 集合若漏成员/多成员,这条会红。
#[test]
fn large_type_set_matches_brute_force() {
    let mut c = db();
    let guo = ensure_path(&c, &["国籍".into()]).unwrap();
    let suo = ensure_path(&c, &["所在".into()]).unwrap();
    for claimed in ["中国", "日本", "法国/巴黎", "地点/旧"] {
        let segs: Vec<String> = claimed.split('/').map(Into::into).collect();
        let id = ensure_path(&c, &segs).unwrap();
        set_tag_relation(&mut c, id, guo, "").unwrap();
    }
    let solo = ensure_path(&c, &["家".into()]).unwrap();
    set_tag_relation(&mut c, solo, suo, "").unwrap();

    let mut expected: Vec<String> = Vec::new();
    for (label, tag, hit) in [
        ("L0", "中国", true),
        ("L1", "中国/上海", true),
        ("L2", "日本", true),
        ("L3", "法国/巴黎", true),
        ("L4", "法国/巴黎/一区", true),
        ("L5", "法国/里昂", false),
        ("L6", "地点/旧/子", true),
        ("L7", "中国X", false),
        ("L8", "家", false),
        ("L9", "书", false),
    ] {
        create_plain(&mut c, &format!("{label} #{tag}")).unwrap();
        if hit {
            expected.push(label.to_string());
        }
    }
    // 携带者:作者/丸尾 携带 国籍 —— 它自己与后代命中,祖先不命中
    let author = ensure_path(&c, &["作者".into(), "丸尾".into()]).unwrap();
    set_tag_relation(&mut c, author, guo, "").unwrap();
    create_plain(&mut c, "L10 #作者/丸尾").unwrap();
    create_plain(&mut c, "L11 #作者/丸尾/甲").unwrap();
    create_plain(&mut c, "L12 #作者").unwrap();
    expected.extend(["L10".into(), "L11".into()]);
    expected.sort();

    assert_eq!(hits(&c, &include("国籍")), expected, "命中集必须与暴力枚举一致");
    assert_eq!(hits(&c, &include("所在")), vec!["L8"], "另一个类型只命中自己的认领");
}

