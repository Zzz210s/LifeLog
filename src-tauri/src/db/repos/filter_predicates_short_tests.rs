//! `keyword_predicate` 的 <3 字退化分支:2 字标签名必须能命中(spec §4.1)。
//! trigram 对 <3 字命中不到,搜索侧靠 LIKE 的 `t.path` 与 `t.name` 兜底;这里构造
//! 「名字不在路径里」的标签,把名字分支单独钉住 —— 去掉 `t.name LIKE ?` 本用例必红。
use super::{empty, FilterConditions};
use crate::db::repos::notes::{create_plain, query};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    crate::db::migrate::run(&c).unwrap();
    c
}

fn hits(c: &Connection, k: &str) -> Vec<i64> {
    let conds = FilterConditions { keyword: Some(k.into()), ..empty() };
    query(c, &conds, 0).unwrap().into_iter().map(|n| n.id).collect()
}

/// 2 字标签名经名字分支命中。把标签路径改成不含名字的两个字(真实库里名字恒是路径叶子,
/// 这里刻意造不一致),路径 LIKE 必然落空,只有 `t.name LIKE` 能捞到 —— 该分支的独立证据。
#[test]
fn two_char_tag_name_matches_via_name_like() {
    let mut c = db();
    let n = create_plain(&mut c, "莽山栈道 #湖南").unwrap();
    c.execute("UPDATE tags SET path = '区划' WHERE name = '湖南'", []).unwrap();
    assert_eq!(hits(&c, "湖南"), vec![n.id], "2 字标签名必须经 t.name LIKE 命中");
    assert!(hits(&c, "湖北").is_empty(), "不误伤其它 2 字关键词");
}
