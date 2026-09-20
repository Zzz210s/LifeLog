//! 带别名的补全测试(G3 spec §4 complete_tags 扩展,测试先行):
//! 标签项 kind="tag"(语义与顺序不变)、别名项 kind="alias" 且 path 是目标标签的**当前路径**;
//! 同一 path 只出现一次且标签优先;别名按"别名字符串"前缀命中,不按目标路径。
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

/// ① 无别名时与旧契约同语义:路径升序、全部 kind="tag"
#[test]
fn without_alias_behaves_like_plain_complete() {
    let mut c = db();
    notes::create_plain(&mut c, "a #工作/项目A #生活").unwrap();
    assert_eq!(
        complete_with_aliases(&c, "工").unwrap(),
        vec![item("工作", "tag"), item("工作/项目A", "tag")]
    );
    assert!(complete_with_aliases(&c, "无此").unwrap().is_empty());
}

/// ② 别名按**别名字符串**前缀命中,返回的是目标标签当前路径,kind="alias",排在标签项之后
#[test]
fn alias_prefix_matches_alias_string_and_returns_target_path() {
    let mut c = db();
    notes::create_plain(&mut c, "看番 #追番/日漫").unwrap();
    let target = id_at(&c, "追番/日漫");
    tag_alias::add(&c, "日漫", target).unwrap();

    assert_eq!(
        complete_with_aliases(&c, "日").unwrap(),
        vec![item("追番/日漫", "alias")],
        "别名命中:path 是目标路径,kind=alias"
    );
    // 目标路径前缀命中仍是标签项;两种命中在同一前缀下并存,标签在前
    assert_eq!(
        complete_with_aliases(&c, "追").unwrap(),
        vec![item("追番", "tag"), item("追番/日漫", "tag")]
    );
    // 别名不产生新节点:整个库只有 追番 与 追番/日漫
    let n: i64 = c.query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 2);
}

/// ③ 同一 path 只出现一次且标签优先:别名指向的路径本身就是标签命中项时不重复出现
#[test]
fn dedupes_by_path_keeping_tag() {
    let mut c = db();
    notes::create_plain(&mut c, "a #工作/项目A").unwrap();
    let target = id_at(&c, "工作/项目A");
    tag_alias::add(&c, "项目甲", target).unwrap();

    // 前缀 "工作" 命中标签;前缀 "项" 同时命中别名 项目甲 与标签 工作/项目A?否 —— 只命中别名
    assert_eq!(
        complete_with_aliases(&c, "项").unwrap(),
        vec![item("工作/项目A", "alias")]
    );
    // 前缀 "工作" 命中标签 工作/项目A;别名 项目甲 不命中,故只有标签项
    let all = complete_with_aliases(&c, "工作").unwrap();
    assert_eq!(all, vec![item("工作", "tag"), item("工作/项目A", "tag")]);
    assert_eq!(all.iter().filter(|i| i.path == "工作/项目A").count(), 1);
    // 空前缀下别名路径与标签路径重合:标签项保留,别名项被丢掉
    let wide = complete_with_aliases(&c, "").unwrap();
    assert_eq!(wide.iter().filter(|i| i.path == "工作/项目A").count(), 1);
    assert_eq!(
        wide.iter().find(|i| i.path == "工作/项目A").unwrap().kind,
        "tag",
        "去重时标签优先"
    );
}

/// ④ 别名存的是指向:目标改名后补全里给的是新路径
#[test]
fn alias_item_follows_target_rename() {
    let mut c = db();
    notes::create_plain(&mut c, "看番 #追番/日漫").unwrap();
    let target = id_at(&c, "追番/日漫");
    tag_alias::add(&c, "日漫", target).unwrap();
    rename(&mut c, target, "动画").unwrap();

    assert_eq!(
        complete_with_aliases(&c, "日").unwrap(),
        vec![item("追番/动画", "alias")]
    );
}

/// ⑤ 两类命中并存时标签项在前、别名项在后(别名目标路径不以词元开头也照样给)
#[test]
fn alias_items_are_appended_after_tag_items() {
    let mut c = db();
    notes::create_plain(&mut c, "a #日子 #追番/日漫").unwrap();
    let target = id_at(&c, "追番/日漫");
    tag_alias::add(&c, "日漫", target).unwrap();

    assert_eq!(
        complete_with_aliases(&c, "日").unwrap(),
        vec![item("日子", "tag"), item("追番/日漫", "alias")],
        "标签项在前;别名项的目标路径不必以词元开头(后端按别名字符串筛)"
    );
}

/// ⑥ 上限仍是 COMPLETE_LIMIT:标签项占满时不得越限追加别名项
#[test]
fn respects_complete_limit() {
    let mut c = db();
    // 51 个根标签(两位补零保证路径序稳定)-> 单靠标签项就已达上限 50
    for i in 0..51 {
        notes::create_plain(&mut c, &format!("n{i} #标签{i:02}")).unwrap();
    }
    let target = id_at(&c, "标签00");
    tag_alias::add(&c, "别名甲", target).unwrap();

    let rows = complete_with_aliases(&c, "").unwrap();
    assert_eq!(rows.len(), 50, "不得超过 COMPLETE_LIMIT");
    assert!(rows.iter().all(|i| i.kind == "tag"), "标签项占满时不追加别名项");
}
