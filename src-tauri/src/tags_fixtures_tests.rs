//! 共享测试向量(仓库根 `fixtures/tag-grammar.json`)的 Rust 侧断言。
//! 这份 JSON 是**两侧唯一真源**:定义"笔记源码 -> 保存后的正文 + 标签集合",
//! 前端契约测试读同一文件(见 `src/shared/fixtures.test.ts`)。
//! 断言对象就是保存路径本身:`tags::extract_tags_known`(抽标签路径)+ `tags::extract_lines_known`
//! (路径 + 关系名,向量里的可选 `lines` 字段)+ `notes_parse::strip_tags`(剥标签),
//! 因此任何语法漂移都会让两侧测试同时变红,而不是靠人肉对齐边界用例。
use crate::db::repos::notes::notes_parse::strip_tags;
use crate::tags::{extract_lines_known, extract_tags, TagLine};
use serde::Deserialize;

const TAG_GRAMMAR: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/tag-grammar.json"
));

/// 一条向量:源码 -> 正文 + 标签集合(`why` 是文档字段,断言不读);
/// `lines` 是关系面(路径 + 名字),缺省表示该向量不声明名字 —— 旧向量的边界不受影响
#[derive(Deserialize)]
struct TagCase {
    source: String,
    content: String,
    tags: Vec<String>,
    #[serde(default)]
    lines: Option<Vec<FixtureLine>>,
}

/// 一条期望的标签线:`name` 为 null = 无名字(空组同义)
#[derive(Deserialize)]
struct FixtureLine {
    path: String,
    name: Option<String>,
}

fn cases() -> Vec<TagCase> {
    serde_json::from_str(TAG_GRAMMAR).expect("fixtures/tag-grammar.json 必须是合法 JSON 数组")
}

/// fixture 本身的结构合法性:不缺字段、tags 非空且无重复、条数达标;
/// 带 `lines` 的向量额外查"名字绝不落进正文"(防半升级:只改了合成、没改剥离)
#[test]
fn fixture_tag_grammar_is_well_formed() {
    let cases = cases();
    assert!(cases.len() >= 25, "共享向量至少 25 条,实际 {}", cases.len());
    let mut named = 0usize;
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
        let Some(lines) = &c.lines else { continue };
        named += lines.iter().filter(|l| l.name.is_some()).count();
        let paths: Vec<&String> = lines.iter().map(|l| &l.path).collect();
        assert_eq!(paths, c.tags.iter().collect::<Vec<_>>(), "第 {i} 条:lines 的路径要与 tags 同序同集");
        for l in lines {
            if let Some(n) = &l.name {
                assert!(!n.is_empty(), "第 {i} 条:名字不能为空串(空组写 name: null)");
                assert!(
                    !c.content.contains(&format!("({n})")),
                    "第 {i} 条:正文里残留名字组 ({n}) —— 剥离没覆盖整组"
                );
            }
        }
    }
    assert!(named >= 15, "关系名向量至少 15 条,实际 {named}");
}

/// 逐条断言:抽标签(路径)、抽标签线(路径 + 名字)与剥标签的输出都必须等于 fixture 声明
#[test]
fn extract_and_strip_match_shared_fixture() {
    for (i, c) in cases().iter().enumerate() {
        assert_eq!(
            extract_tags(&c.source),
            c.tags,
            "第 {i} 条抽标签不一致,源码:{:?}",
            c.source
        );
        if let Some(lines) = &c.lines {
            let want: Vec<TagLine> = lines
                .iter()
                .map(|l| TagLine { path: l.path.clone(), name: l.name.clone() })
                .collect();
            assert_eq!(
                extract_lines_known(&c.source, &[]),
                want,
                "第 {i} 条标签线不一致,源码:{:?}",
                c.source
            );
        }
        assert_eq!(
            strip_tags(&c.source),
            c.content,
            "第 {i} 条剥标签不一致,源码:{:?}",
            c.source
        );
    }
}
