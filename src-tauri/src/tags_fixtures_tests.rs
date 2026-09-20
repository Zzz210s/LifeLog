//! 共享测试向量(仓库根 `fixtures/tag-grammar.json`)的 Rust 侧断言。
//! 这份 JSON 是**两侧唯一真源**:定义"笔记源码 -> 保存后的正文 + 标签集合",
//! 前端契约测试读同一文件(见 `src/shared/fixtures.test.ts`)。
//! 断言对象就是保存路径本身:`tags::extract_tags`(抽标签)+ `db::repos::notes::strip_tags`(剥标签),
//! 因此任何语法漂移都会让两侧测试同时变红,而不是靠人肉对齐边界用例。
use crate::db::repos::notes::strip_tags;
use crate::tags::extract_tags;
use serde::Deserialize;

const TAG_GRAMMAR: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/tag-grammar.json"
));

/// 一条向量:源码 -> 正文 + 标签集合(`why` 是文档字段,断言不读)
#[derive(Deserialize)]
struct TagCase {
    source: String,
    content: String,
    tags: Vec<String>,
}

fn cases() -> Vec<TagCase> {
    serde_json::from_str(TAG_GRAMMAR).expect("fixtures/tag-grammar.json 必须是合法 JSON 数组")
}

/// fixture 本身的结构合法性:不缺字段、tags 非空且无重复、条数达标
#[test]
fn fixture_tag_grammar_is_well_formed() {
    let cases = cases();
    assert!(cases.len() >= 25, "共享向量至少 25 条,实际 {}", cases.len());
    for (i, c) in cases.iter().enumerate() {
        assert!(!c.source.is_empty() || c.tags.is_empty(), "第 {i} 条:空源码不该声明标签");
        for t in &c.tags {
            assert!(!t.is_empty(), "第 {i} 条:标签不能为空串");
            assert_eq!(t.trim(), t, "第 {i} 条:标签名不含首尾空白:{t}");
        }
        let mut sorted = c.tags.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), c.tags.len(), "第 {i} 条:tags 不得重复:{:?}", c.tags);
        // 正文里不得再残留声明过的标签词元(剥离路径的自我一致性)
        for t in &c.tags {
            assert!(
                !c.content.contains(&format!("#{t}")),
                "第 {i} 条:正文里仍残留 #{t}"
            );
        }
    }
}

/// 逐条断言:抽标签与剥标签的输出都必须等于 fixture 声明
#[test]
fn extract_and_strip_match_shared_fixture() {
    for (i, c) in cases().iter().enumerate() {
        assert_eq!(
            extract_tags(&c.source),
            c.tags,
            "第 {i} 条抽标签不一致,源码:{:?}",
            c.source
        );
        assert_eq!(
            strip_tags(&c.source),
            c.content,
            "第 {i} 条剥标签不一致,源码:{:?}",
            c.source
        );
    }
}
