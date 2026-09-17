//! notes 流查询层测试(query),测试先行(TDD)
use crate::db::migrate;
use crate::db::repos::notes::{notes_filter::*, notes_query::PAGE_SIZE, query};
use crate::db::repos::notes::{create_on, create_plain};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

/// 简化构造:精确路径标签(含子级开关另有条件测试覆盖)
fn f(keyword: Option<&str>, tags: &[&str]) -> FilterConditions {
    FilterConditions {
        keyword: keyword.map(String::from),
        tags: tags
            .iter()
            .map(|s| TagCond { path: s.to_string(), include_children: false })
            .collect(),
        ..empty()
    }
}

fn contents(notes: &[crate::db::repos::notes::Note]) -> Vec<String> {
    notes.iter().map(|n| n.content.clone()).collect()
}

#[test]
fn query_fts_keyword_hits_and_misses() {
    let mut c = db();
    create_plain(&mut c, "今天心情很好").unwrap();
    create_plain(&mut c, "天气不错").unwrap();
    // >=3 字符走 FTS trigram 子串匹配
    let hit = query(&c, &f(Some("心情很好"), &[]), 0).unwrap();
    assert_eq!(hit.len(), 1);
    assert_eq!(hit[0].content, "今天心情很好");
    let miss = query(&c, &f(Some("心情不美丽"), &[]), 0).unwrap();
    assert!(miss.is_empty(), "不应命中:{miss:?}");
}

#[test]
fn query_short_keyword_degrades_to_like() {
    let mut c = db();
    create_plain(&mut c, "今天心情很好").unwrap();
    create_plain(&mut c, "天气不错").unwrap();
    // 2 字符退化 LIKE:命中目标且不误伤另一条
    let a = query(&c, &f(Some("心情"), &[]), 0).unwrap();
    assert_eq!(contents(&a), vec!["今天心情很好"]);
    let b = query(&c, &f(Some("天气"), &[]), 0).unwrap();
    assert_eq!(contents(&b), vec!["天气不错"]);
}

#[test]
fn query_tags_filter_and_semantics() {
    let mut c = db();
    create_plain(&mut c, "看了一部 #电影 #神作").unwrap();
    create_plain(&mut c, "另一部 #电影").unwrap();
    create_plain(&mut c, "随便记记").unwrap();
    let one = query(&c, &f(None, &["电影"]), 0).unwrap();
    assert_eq!(one.len(), 2);
    // AND 语义:两标签都有才命中
    let both = query(&c, &f(None, &["电影", "神作"]), 0).unwrap();
    assert_eq!(both.len(), 1);
    assert_eq!(both[0].tags, vec!["电影", "神作"]);
    assert!(query(&c, &f(None, &["不存在"]), 0).unwrap().is_empty());
}

#[test]
fn query_oldest_first_flips_order() {
    let mut c = db();
    for (i, t) in ["甲", "乙", "丙", "丁"].iter().enumerate() {
        create_on(&mut c, t, &format!("2026-01-0{}", i + 1)).unwrap();
    }
    let newest = query(&c, &f(None, &[]), 0).unwrap();
    assert_eq!(contents(&newest), vec!["丁", "丙", "乙", "甲"]);
    let mut asc = f(None, &[]);
    asc.sort = Some("oldest".into());
    let oldest = query(&c, &asc, 0).unwrap();
    assert_eq!(contents(&oldest), vec!["甲", "乙", "丙", "丁"]);
}

#[test]
fn query_pages_by_offset_with_fixed_page_size() {
    let mut c = db();
    for i in 0..52 {
        create_plain(&mut c, &format!("n{i:02}")).unwrap();
    }
    let p1 = query(&c, &f(None, &[]), 0).unwrap();
    assert_eq!(p1.len(), PAGE_SIZE as usize);
    assert_eq!(p1[0].content, "n51");
    // 第二页从行偏移 50 起,只剩 2 条
    let p2 = query(&c, &f(None, &[]), 50).unwrap();
    assert_eq!(contents(&p2), vec!["n01", "n00"]);
}

#[test]
fn query_keyword_hits_tags_column() {
    let mut c = db();
    create_plain(&mut c, "#流浪地球 评价不错").unwrap(); // 正文剥离后仅"评价不错"
    create_plain(&mut c, "无关笔记").unwrap();
    // 4 字关键词走 FTS,命中聚合进 tags 列的标签路径
    let via_fts = query(&c, &f(Some("流浪地球"), &[]), 0).unwrap();
    assert_eq!(via_fts.len(), 1);
    assert_eq!(via_fts[0].tags, vec!["流浪地球"]);
    // 2 字关键词退化 LIKE 时同样覆盖标签名
    create_plain(&mut c, "#电影 神作").unwrap();
    let via_like = query(&c, &f(Some("电影"), &[]), 0).unwrap();
    assert_eq!(via_like.len(), 1);
    assert_eq!(via_like[0].content, "神作");
}

#[test]
fn tags_expose_full_path_not_leaf_name() {
    let mut c = db();
    let n = create_plain(&mut c, "纪要 #工作/项目A").unwrap();
    assert_eq!(n.tags, vec!["工作/项目A"]);
    // 读回也必须是路径:query 的 tags 列不得退化成末级名
    let got = query(&c, &f(None, &[]), 0).unwrap();
    assert_eq!(got[0].tags, vec!["工作/项目A"]);
}

#[test]
fn tag_filter_is_exact_path_match() {
    let mut c = db();
    create_plain(&mut c, "开会 #工作/项目A/会议").unwrap();
    create_plain(&mut c, "周报 #工作/项目A").unwrap();
    create_plain(&mut c, "杂记 #工作").unwrap();
    // 精确路径:只命中直接打了该路径的笔记
    let leaf = query(&c, &f(None, &["工作/项目A"]), 0).unwrap();
    assert_eq!(contents(&leaf), vec!["周报"]);
    // "仅本级"不做前缀扩展:只命中直接打了"工作"的那条
    let parent = query(&c, &f(None, &["工作"]), 0).unwrap();
    assert_eq!(contents(&parent), vec!["杂记"]);
}

#[test]
fn raw_update_keeps_fts_in_sync() {
    let mut c = db();
    let n = create_plain(&mut c, "旧正文 #电影").unwrap();
    c.execute("UPDATE notes SET content='新正文关键词' WHERE id=?1", [&n.id]).unwrap();
    // notes_au 触发器:新词可检索、旧词不再命中(标签聚合保留)
    assert_eq!(query(&c, &f(Some("新正文关键"), &[]), 0).unwrap().len(), 1);
    assert!(query(&c, &f(Some("旧正文"), &[]), 0).unwrap().is_empty());
    assert_eq!(query(&c, &f(Some("电影"), &[]), 0).unwrap().len(), 1);
}

#[test]
fn query_keyword_and_tags_combine() {
    let mut c = db();
    create_plain(&mut c, "看完 #电影 神作").unwrap();
    create_plain(&mut c, "听完 #电影 原声").unwrap();
    create_plain(&mut c, "读完 神作").unwrap();
    // 关键词与标签同时生效(AND)
    let r = query(&c, &f(Some("神作"), &["电影"]), 0).unwrap();
    assert_eq!(contents(&r), vec!["看完 神作"]);
}
/// 带时间标签的分页跨页不重不漏(D1:排序改为按 notes.id,时间标签不再参与排序)
#[test]
fn query_pages_by_id_desc() {
    let mut c = db();
    // 52 条各带不同日期:2026-01-01 .. 2026-02-21
    for i in 0..52i64 {
        let date = if i < 31 {
            format!("2026-01-{:02}", i + 1)
        } else {
            format!("2026-02-{:02}", i - 30)
        };
        create_on(&mut c, &format!("n{i:02}"), &date).unwrap();
    }
    let p1 = query(&c, &f(None, &[]), 0).unwrap();
    assert_eq!(p1.len(), PAGE_SIZE as usize);
    assert_eq!(p1[0].content, "n51", "最新在前:按 id 降序");
    assert_eq!(p1[1].content, "n50");
    assert!(
        p1.iter().all(|n| n.tags.iter().any(|t| t.starts_with("时间排序/"))),
        "每条都带自动时间标签(且仍随结果返回)"
    );
    let p2 = query(&c, &f(None, &[]), 50).unwrap();
    assert_eq!(contents(&p2), vec!["n01", "n00"]);
}

