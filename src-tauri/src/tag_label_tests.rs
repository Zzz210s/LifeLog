//! T2:`label_plain` 与前端的同源证明 —— 逐条读共享向量 `fixtures/tag-label.json`
//! (前端 `src/shared/tag-label.test.ts` 读同一份文件)。
//! 两侧任何一方改了 md 语法,这个测试与前端那条会同时红。
//! 界面口径的校验用例(怎么算合法名字/路径)在 `tag_label_valid_tests.rs`,那半边只谈校验。
use super::{label_plain, parse_label};
use crate::tag_label_plain::LabelToken;
use serde::Deserialize;

const TAG_LABEL: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/tag-label.json"
));

/// 一条向量(raw -> plain;`why` / `html` 是前端用的文档字段,断言不读)
#[derive(Deserialize)]
struct LabelCase {
    raw: String,
    plain: String,
}

fn cases() -> Vec<LabelCase> {
    serde_json::from_str(TAG_LABEL).expect("fixtures/tag-label.json 必须是合法 JSON 数组")
}

/// fixture 结构本身:条数达标,且确实有"真去语法"的条目(否则断言没有意义)
#[test]
fn fixture_tag_label_is_well_formed() {
    let cases = cases();
    assert!(cases.len() >= 20, "共享向量至少 20 条,实际 {}", cases.len());
    assert!(
        cases.iter().any(|c| c.raw != c.plain),
        "向量里得有条目 raw != plain,否则纯文本算法没被验到"
    );
}

/// 逐条:label_plain 必须等于前端声明的纯文本
#[test]
fn label_plain_matches_shared_fixture() {
    for (i, c) in cases().iter().enumerate() {
        assert_eq!(label_plain(&c.raw), c.plain, "第 {i} 条纯文本不一致,raw={:?}", c.raw);
    }
}

/// T1:删除线 / 下划线强调 / 反斜杠转义的 token 形态。
/// 纯文本口径由共享向量逐条把关,这里钉住确实产出了对应 kind
/// (否则前端渲染 `<del>` / `<em>` 那一侧就没有镜像可对)。
#[test]
fn inline_extensions_produce_expected_tokens() {
    assert_eq!(parse_label("~~删除线~~"), vec![LabelToken::Del("删除线".into())]);
    assert_eq!(parse_label("_斜体_"), vec![LabelToken::Em("斜体".into())]);
    assert_eq!(parse_label("__粗体__"), vec![LabelToken::Strong("粗体".into())]);
    // flanking 守卫:词内下划线不得被吃掉(否则真实标签名全遭殃)
    assert_eq!(parse_label("a_b_c"), vec![LabelToken::Text("a_b_c".into())]);
    assert_eq!(parse_label("snake_case"), vec![LabelToken::Text("snake_case".into())]);
    assert_eq!(parse_label("工作__重点__"), vec![LabelToken::Text("工作__重点__".into())]);
    // 删除线没有 flanking 约束(与正文 GFM 一致:词内也生效)
    assert_eq!(
        parse_label("x~~y~~z"),
        vec![
            LabelToken::Text("x".into()),
            LabelToken::Del("y".into()),
            LabelToken::Text("z".into()),
        ]
    );
    // 反斜杠转义:去反斜杠,且被转义的定界符不再生效
    assert_eq!(parse_label("\\*"), vec![LabelToken::Text("*".into())]);
    assert_eq!(parse_label("\\_斜体\\_"), vec![LabelToken::Text("_斜体_".into())]);
    assert_eq!(parse_label("\\"), vec![LabelToken::Text("\\".into())]);
}

/// 无语法名走"单文本 token"退化(与前端 renderTagLabel 直接返回字符串同口径)
#[test]
fn plain_text_name_is_a_single_text_token() {
    assert_eq!(parse_label("纯中文"), vec![LabelToken::Text("纯中文".to_string())]);
    assert_eq!(label_plain("地点/美国"), "地点/美国");
    assert!(parse_label("").is_empty(), "空串无 token");
}
