//! links.rs 的用例 + 共享向量(仓库根 `fixtures/note-links.json`)的 Rust 侧断言。
//! 这份 JSON 两侧同读(前端见 `src/shared/note-link-syntax.test.ts`),把"跳过口径"钉死 ——
//! 围栏/行内代码/转义任一处漂移,两侧同一向量同时变红。
use super::{link_spans, normalize_title, title_of};
use serde::Deserialize;

const FIXTURE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/note-links.json"
));

#[derive(Deserialize)]
struct Fixture {
    spans: Vec<SpanCase>,
    titles: Vec<TitleCase>,
}

#[derive(Deserialize)]
struct SpanCase {
    name: String,
    content: String,
    expect: Vec<String>,
}

#[derive(Deserialize)]
struct TitleCase {
    name: String,
    content: String,
    expect: String,
}

fn fixture() -> Fixture {
    serde_json::from_str(FIXTURE).expect("fixtures/note-links.json 必须是合法 JSON")
}

#[test]
fn fixture_is_well_formed() {
    let f = fixture();
    assert!(f.spans.len() >= 9, "链接向量至少 9 条,实际 {}", f.spans.len());
    assert!(f.titles.len() >= 5, "标题向量至少 5 条,实际 {}", f.titles.len());
    for c in &f.spans {
        assert!(!c.name.is_empty(), "向量缺 name");
    }
}

#[test]
fn link_spans_match_shared_fixture() {
    for c in fixture().spans {
        let got: Vec<String> =
            link_spans(&c.content).into_iter().map(|s| s.raw_title).collect();
        assert_eq!(got, c.expect, "向量「{}」不符,源码:{:?}", c.name, c.content);
    }
}

#[test]
fn title_of_matches_shared_fixture() {
    for c in fixture().titles {
        assert_eq!(title_of(&c.content), c.expect, "向量「{}」不符", c.name);
    }
}

/// 区间自洽:start/end 必须正好切出 `[[…]]` 原文(渲染期切片依赖这一点)
#[test]
fn spans_bracket_the_raw_text() {
    let content = "看 [[今天聚会]] 与 [[乙]]";
    let spans = link_spans(content);
    assert_eq!(spans.len(), 2);
    assert_eq!(&content[spans[0].start..spans[0].end], "[[今天聚会]]");
    assert_eq!(&content[spans[1].start..spans[1].end], "[[乙]]");
}

/// 长度上限按**字符**算:200 收,201 整串字面
#[test]
fn title_length_limit_is_measured_in_chars() {
    let ok = "字".repeat(200);
    assert_eq!(link_spans(&format!("[[{ok}]]")).len(), 1);
    let too_long = "字".repeat(201);
    assert!(link_spans(&format!("[[{too_long}]]")).is_empty());
}

/// 标题里的 `#标签` 词元不参与匹配,但词元前后的文字保留
#[test]
fn normalize_title_strips_tag_tokens() {
    assert_eq!(normalize_title("  聚会  #日记  "), "聚会");
    assert_eq!(normalize_title("#安利/软件"), "");
    assert_eq!(normalize_title("Hello   World"), "hello world");
}
