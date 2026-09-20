//! `parse_note_source` 与保存路径同源的属性测试:对共享 fixture 的每一条源码,
//! 命令输出必须等于"**真的存一条**同样源码的笔记后,从库里读回的正文与标签"
//! (内存库,绝不碰真实库),同时等于 fixture 声明 —— 命令、保存路径、向量三者一致。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes::create_plain;
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
    conn
}

#[test]
fn command_output_equals_actually_saved_note() {
    let mut conn = memory_db();
    let cases: Vec<TagCase> = serde_json::from_str(TAG_GRAMMAR).unwrap();
    assert!(cases.len() >= 25, "共享向量至少 25 条,实际 {}", cases.len());
    for (i, case) in cases.iter().enumerate() {
        let parsed = parse_note_source(case.source.clone());
        // 真存一条:库里的返回值就是保存路径(create/update 同一对函数)的读数
        let saved = create_plain(&mut conn, &case.source).unwrap();
        assert_eq!(parsed.content, saved.content, "第 {i} 条正文与保存路径不一致:{:?}", case.source);
        assert_eq!(parsed.tags, saved.tags, "第 {i} 条标签与保存路径不一致:{:?}", case.source);
        assert_eq!(saved.content, case.content, "第 {i} 条正文与 fixture 不一致:{:?}", case.source);
        assert_eq!(saved.tags, case.tags, "第 {i} 条标签与 fixture 不一致:{:?}", case.source);
    }
}

#[test]
fn command_is_pure_and_preserves_source_untouched() {
    let src = "记录 #工作/项目A 与 #生活".to_string();
    let before = src.clone();
    let r = parse_note_source(src.clone());
    assert_eq!(src, before, "命令不得改写调用方传入的源码");
    assert_eq!(r.tags, vec!["工作/项目A".to_string(), "生活".to_string()]);
    assert_eq!(r.content, "记录 与");
}
