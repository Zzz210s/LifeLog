//! `parse_note_source` 与保存路径同源的属性测试:对共享 fixture 的每一条源码,
//! 命令输出必须等于"**真的存一条**同样源码的笔记后,从库里读回的正文与标签"
//! (内存库,绝不碰真实库),同时等于 fixture 声明 —— 命令、保存路径、向量三者一致。
//!
//! 注意口径(Important-2):命令与保存路径**共用同一个 `notes::parse_saved`**,
//! 因此"两者一致"是无条件成立的(而不是只在"库里没有可兜底路径"时才成立);
//! fixture 里的源码全是严格语法可解析的,故"等于 fixture"这条仍按原义成立。
//! 库内已有 md 形态路径时的一致由 `command_matches_save_with_md_path_in_library` 单独钉。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes::create_plain;
use crate::db::repos::tags::test_support::install_entity_views;
use crate::db::repos::tags::rename;
use rusqlite::Connection;
use serde::Deserialize;

const TAG_GRAMMAR: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/tag-grammar.json"
));

#[derive(Deserialize)]
struct TagCase {
    source: String,
    content: String,
    tags: Vec<String>,
}

fn memory_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    migrate::run(&conn).unwrap();
    // 阶段 4 起标签正文兜底读 `entities`(老 `tags` 表已不再写),夹具把老表换成只读视图,
    // 使 `notes::parse_saved` 的库内路径候选与用例里的 `SELECT id FROM tags` 都落到新表上。
    install_entity_views(&conn);
    conn
}

#[test]
fn command_output_equals_actually_saved_note() {
    let mut conn = memory_db();
    let cases: Vec<TagCase> = serde_json::from_str(TAG_GRAMMAR).unwrap();
    assert!(cases.len() >= 25, "共享向量至少 25 条,实际 {}", cases.len());
    for (i, case) in cases.iter().enumerate() {
        let parsed = parse_source(&conn, &case.source).unwrap();
        // 真存一条:库里的返回值就是保存路径(create/update 同一对函数)的读数
        let saved = create_plain(&mut conn, &case.source).unwrap();
        assert_eq!(parsed.content, saved.content, "第 {i} 条正文与保存路径不一致:{:?}", case.source);
        assert_eq!(parsed.tags, saved.tags, "第 {i} 条标签与保存路径不一致:{:?}", case.source);
        assert_eq!(saved.content, case.content, "第 {i} 条正文与 fixture 不一致:{:?}", case.source);
        assert_eq!(saved.tags, case.tags, "第 {i} 条标签与 fixture 不一致:{:?}", case.source);
    }
}

/// 库内已有 md 形态路径时的向量(Important-2 的复现读数):
/// 库里的路径正是前端 `composeSource` 回显的**原始路径**,命令必须与保存路径给出同一读数 ——
/// 旧实现(严格 `tags::extract_tags`)在这里给 `tags=[]`,编辑面板显示「标签 0 个」。
/// 前置照 `notes_save_fallback_tests::seed_md_note`:先存普通路径,再改名成 md 形态
/// (md 名字里的 `[` 不在正文名称字符集里,所以它只可能从"库里已有"这一侧来)。
#[test]
fn command_matches_save_with_md_path_in_library() {
    let mut conn = memory_db();
    let mid = "地点/中国大陆/湖南省/郴chen州市";
    let leaf = "地点/中国大陆/湖南省/[郴](chēn)州市/宜章县";
    create_plain(&mut conn, &format!("莽山栈道 #{mid}/宜章县")).unwrap();
    let mid_id: i64 = conn
        .query_row("SELECT id FROM tags WHERE path=?1", [mid], |r| r.get(0))
        .unwrap();
    rename(&mut conn, mid_id, "[郴](chēn)州市").unwrap();

    let src = format!("莽山栈道\n#{leaf}");
    let parsed = parse_source(&conn, &src).unwrap();
    let saved = create_plain(&mut conn, &src).unwrap();
    assert_eq!(parsed.tags, vec![leaf.to_string()], "命令必须认出库内已有的 md 路径");
    assert_eq!(parsed.content, "莽山栈道\n", "正文不得残留 md 源码");
    assert_eq!(parsed.tags, saved.tags, "命令与保存路径必须同读数(标签)");
    assert_eq!(parsed.content, saved.content, "命令与保存路径必须同读数(正文)");
}

#[test]
fn command_is_pure_and_preserves_source_untouched() {
    let conn = memory_db();
    let src = "记录 #工作/项目A 与 #生活".to_string();
    let before = src.clone();
    let r = parse_source(&conn, &src).unwrap();
    assert_eq!(src, before, "命令不得改写调用方传入的源码");
    assert_eq!(r.tags, vec!["工作/项目A".to_string(), "生活".to_string()]);
    assert_eq!(r.content, "记录 与");
}
