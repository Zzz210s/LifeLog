//! 共享测试向量(仓库根 `fixtures/expr-tag-spans.json`)的 Rust 侧断言。
//! 这份 JSON 是两侧唯一真源:定义「表达式原文 -> 标签叶子 `[路径, 首字符下标, 尾后字符下标]`」
//! (下标为字符下标 = Unicode 码位)。前端镜像实现 `src/main-window/filter/expr-tag-spans.ts`
//! 读同一份文件并真跑 `exprTagSpans`(见 `src/main-window/filter/expr-tag-spans.test.ts`),
//! 因此任一侧的字符集/边界漂移都会让两侧测试同时变红。
use super::lexer::{lex_spans, Token};
use serde::Deserialize;

const EXPR_TAG_SPANS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/expr-tag-spans.json"
));

/// 一条向量:`tags` 为期望的标签叶子;`lex_error` 为真表示此处词法整体报错(前端镜像此时不产叶子)
#[derive(Deserialize)]
struct Case {
    why: String,
    src: String,
    tags: Vec<(String, usize, usize)>,
    #[serde(default, rename = "lexError")]
    lex_error: bool,
}

fn cases() -> Vec<Case> {
    serde_json::from_str(EXPR_TAG_SPANS).expect("fixtures/expr-tag-spans.json 必须是合法 JSON 数组")
}

/// fixture 结构:条数达标,且确实覆盖了「词法报错」与「非 ASCII 路径」两类(否则断言没有意义)
#[test]
fn fixture_expr_tag_spans_is_well_formed() {
    let cases = cases();
    assert!(cases.len() >= 12, "共享向量至少 12 条,实际 {}", cases.len());
    assert!(cases.iter().any(|c| c.lex_error), "必须含词法报错的反例");
    assert!(
        cases.iter().any(|c| c.tags.iter().any(|(p, ..)| !p.is_ascii())),
        "必须含非 ASCII 路径(码位口径的判别力)"
    );
    for (i, c) in cases.iter().enumerate() {
        for (p, s, e) in &c.tags {
            assert!(!p.is_empty(), "第 {i} 条:路径不能为空串");
            assert!(s < e, "第 {i} 条:区间非空({s}..{e})");
        }
    }
}

/// 逐条:词法产出的标签叶子必须与共享向量一致(报错态与声明互斥)
#[test]
fn lexer_tag_spans_match_shared_fixture() {
    for (i, c) in cases().iter().enumerate() {
        let got = lex_spans(&c.src);
        if c.lex_error {
            assert!(got.is_err(), "第 {i} 条({}):期望词法报错,实际 {:?}", c.why, got);
            assert!(c.tags.is_empty(), "第 {i} 条:词法报错就不该声明标签");
            continue;
        }
        let toks = got.unwrap_or_else(|e| panic!("第 {i} 条({})意外报错:{}", c.why, e.message));
        let spans: Vec<(String, usize, usize)> = toks
            .into_iter()
            .filter_map(|(t, s, e)| match t {
                Token::Tag { path, .. } => Some((path, s, e)),
                _ => None,
            })
            .collect();
        assert_eq!(spans, c.tags, "第 {i} 条({})标签叶子不一致", c.why);
    }
}
