//! T5 核心读数:标签路径**祖先段**带行内 md、笔记链的是**叶子**时,按显示文本可搜。
//! 这是 T4 覆盖不到的真缺口(真实库形态:笔记挂 `地点/…/[郴](chēn)州市/宜章县`,
//! 带 md 的名字在祖先段上,T4 只并"直接链接标签"的别名 -> 搜 `郴州市` 0 条)。
//! ① 祖先段 md + 链叶子:显示文本与注解字面量都命中,不变量成立;
//! ② 纯文本别名被真实标签占住时,显示文本只能靠 `tag_plain` 的**纯文本路径**兜住
//!    (把表达式里的 `tag_plain(t.path)` 拿掉,这条必红 —— 非别名来源的独立证据)。
//! 边界有意钉住:**祖先标签的旧名不进索引**(别名口径仍是 T4 的"直接链接的标签",
//! 扩到祖先链会违反既有不变量「改名后旧路径不得残留」)。
use crate::db::migrate;
use crate::db::repos::notes::{create_plain, notes_filter::empty, query as query_all, FilterConditions};
use crate::db::repos::tags::invariants_tests::assert_fts_matches_edges;
use crate::db::repos::tags::{alias, rename};
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    crate::db::repos::tags::test_support::install_legacy_name_views(&c);
    c
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", [path], |r| r.get(0)).unwrap()
}

fn fts_tags(c: &Connection, id: i64) -> String {
    c.query_row("SELECT paths FROM entities_fts WHERE rowid=?1", params![id], |r| r.get(0))
        .unwrap()
}

fn hits(c: &Connection, keyword: &str) -> Vec<i64> {
    let conds = FilterConditions { keyword: Some(keyword.into()), ..empty() };
    query(c, &conds, 0).unwrap().into_iter().map(|n| n.id).collect()
}

/// ① 真库形态:五层路径,made 注解在**第 4 段的祖先**上,笔记只链第 5 段叶子
#[test]
fn ancestor_md_with_leaf_link_is_searchable_by_display_text() {
    let mut c = db();
    let n = create_plain(&mut c, "莽山栈道 #地点/中国大陆/湖南省/郴chen州市/宜章县").unwrap();
    let leaf = id_at(&c, "地点/中国大陆/湖南省/郴chen州市/宜章县");
    let ancestor = id_at(&c, "地点/中国大陆/湖南省/郴chen州市");

    // 名字改成行内 md;子树路径跟着重写,笔记的链接仍指向同一个叶子
    rename(&mut c, ancestor, "[郴](chēn)州市").unwrap();
    assert_eq!(id_at(&c, "地点/中国大陆/湖南省/[郴](chēn)州市/宜章县"), leaf, "链接未变");
    assert_eq!(
        c.query_row(
            "SELECT COUNT(*) FROM tag_links WHERE tag_id=?1 AND target_id=?2",
            params![leaf, n.id],
            |r| r.get::<_, i64>(0),
        )
        .unwrap(),
        1,
        "笔记只链叶子,没链带 md 的祖先"
    );
    assert!(
        fts_tags(&c, n.id).contains("地点/中国大陆/湖南省/郴州市/宜章县"),
        "索引串里要有祖先段去 md 后的纯文本路径"
    );

    assert_eq!(hits(&c, "郴州市"), vec![n.id], "显示文本(祖先段的纯文本形态)必须命中");
    assert_eq!(hits(&c, "chēn"), vec![n.id], "注解里的字面量仍走原始路径");
    // 边界(有意):祖先标签的**旧名**不进索引。把祖先链别名也算进来会违反既有不变量
    // 「改名后旧路径不得残留」(tree_time_ops_tests::time_root_can_be_renamed_and_fts_follows),
    // 故别名口径保持 T4 的"直接链接的标签"范围。
    assert!(hits(&c, "郴chen州市").is_empty(), "祖先段的旧名不进索引(与既有不变量一致)");
    assert_fts_matches_edges(&c);
}

/// ② 纯文本别名被占住(叶子名被真实标签占、完整路径被别的标签别名占)-> 显示文本
/// 只能靠 `tag_plain` 的**纯文本路径**兜住 —— 同父纯文本同名会触发自动合并(2026-10-06 §6),
/// 故完整路径用**别名**而非真实标签占位,既挡住别名登记又不制造兄弟重名。
#[test]
fn plain_path_covers_display_text_when_plain_alias_is_taken() {
    let mut c = db();
    let real = create_plain(&mut c, "x #郴州市").unwrap(); // 占住纯文本叶子名
    let owner = id_at(&c, "郴州市");
    alias::add(&c, "地点/郴州市", owner).unwrap(); // 占住纯文本完整路径
    let n = create_plain(&mut c, "莽山栈道 #地点/郴chen州市/宜章县").unwrap();
    let _ = real;
    let ancestor = id_at(&c, "地点/郴chen州市");

    let aliases = rename(&mut c, ancestor, "[郴](chēn)州市").unwrap();
    assert_eq!(
        aliases,
        vec!["地点/郴chen州市".to_string(), "郴chen州市".to_string()],
        "纯文本候选被真实标签占住 -> 跳过,别名里没有 郴州市"
    );
    assert!(hits(&c, "郴州市").contains(&n.id), "纯文本路径是显示文本的唯一来源");
    assert!(!hits(&c, "郴chen州市").contains(&n.id), "祖先旧名不进索引(与非别名来源无关)");
    assert_fts_matches_edges(&c);
}

/// 统一元数据后 `query` 的域是全实体(spec §4.1:清空筛选即显示标签);
/// 本文件的老用例只关心迁移前的「全部笔记」,故把默认筛选并入条件(见 test_support)。
fn query(
    c: &Connection,
    cond: &crate::db::repos::notes::notes_filter::FilterConditions,
    offset: i64,
) -> Result<Vec<crate::db::repos::notes::Note>, String> {
    query_all(c, &crate::db::repos::tags::test_support::with_note_domain(cond.clone()), offset)
}
