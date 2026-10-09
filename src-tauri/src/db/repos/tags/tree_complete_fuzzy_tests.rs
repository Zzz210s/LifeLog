//! 模糊扩展补全的链路测试(A6a,测试先行):输入栏候选池除路径前缀外,还要收**子串 / 子序列**
//! 命中的标签,且以 kind="tag" 返回 —— 排序与 `<mark>` 仍归前端共享打分器(设计 §4.2 纪律 1)。
//! 前缀档恒在前、近义档不被顶掉、上限仍是 COMPLETE_LIMIT、空前缀不扩展。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes;
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn item(path: &str, kind: &str) -> CompleteItem {
    CompleteItem { path: path.to_string(), kind: kind.to_string() }
}

/// ① 设计 §6.3 A6a 的原始例子:`#项A` 的「项」「A」在 `工作/项目A` 里不相邻,
/// 既非前缀也非子串,只能靠**子序列**进候选池;kind 必须是 tag,前端打分器才会给高亮段。
#[test]
fn subsequence_hit_enters_pool_as_tag() {
    let mut c = db();
    notes::create_plain(&mut c, "a #工作/项目A").unwrap();
    assert_eq!(complete_with_aliases(&c, "项A").unwrap(), vec![item("工作/项目A", "tag")]);
}

/// ② 前缀档恒排在扩展档之前(候选池顺序确定;前端仍会按分重排)
#[test]
fn prefix_hits_precede_fuzzy_hits() {
    let mut c = db();
    notes::create_plain(&mut c, "a #项A开头 #工作/项目A").unwrap();
    assert_eq!(
        complete_with_aliases(&c, "项A").unwrap(),
        vec![item("项A开头", "tag"), item("工作/项目A", "tag")]
    );
}

/// ③ 上限仍是 COMPLETE_LIMIT:前缀 1 条 + 子序列命中 60 条 -> 只回 50 条,前缀在首位
#[test]
fn fuzzy_pool_respects_complete_limit() {
    let mut c = db();
    notes::create_plain(&mut c, "a #za锚").unwrap();
    for i in 0..60 {
        notes::create_plain(&mut c, &format!("n{i} #z{i:02}a")).unwrap();
    }
    let rows = complete_with_aliases(&c, "za").unwrap();
    assert_eq!(rows.len(), 50, "不得超过 COMPLETE_LIMIT");
    assert_eq!(rows[0], item("za锚", "tag"), "前缀命中仍占首位");
    assert!(rows.iter().all(|i| i.kind == "tag"));
}

/// ④ 近义档的路径不被扩展档顶掉:叶子名互相包含的路径仍以 kind="similar" 出现在末尾
#[test]
fn similar_tier_paths_are_not_shadowed() {
    let mut c = db();
    notes::create_plain(&mut c, "a #日漫志 #追番/日漫").unwrap();
    assert_eq!(
        complete_with_aliases(&c, "日漫").unwrap(),
        vec![item("日漫志", "tag"), item("追番/日漫", "similar")]
    );
}

/// ⑤ 空前缀(刚敲下 #)不拉扩展档:全量档已由前缀补全给出,不重复堆候选
#[test]
fn empty_token_has_no_fuzzy_expansion() {
    let mut c = db();
    notes::create_plain(&mut c, "a #工作/项目A #生活").unwrap();
    assert_eq!(
        complete_with_aliases(&c, "").unwrap(),
        vec![item("工作", "tag"), item("工作/项目A", "tag"), item("生活", "tag")]
    );
}
