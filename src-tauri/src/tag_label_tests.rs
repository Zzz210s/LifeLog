//! T2:`label_plain` 与前端的同源证明 —— 逐条读共享向量 `fixtures/tag-label.json`
//! (前端 `src/shared/tag-label.test.ts` 读同一份文件),外加界面改名校验的边界。
//! 两侧任何一方改了 md 语法,这个测试与前端那条会同时红。
use super::{label_plain, validate_label, validate_tag_path, MAX_LABEL_CHARS};
use crate::tag_label_plain::{parse_label, LabelToken};
use serde::Deserialize;

const TAG_LABEL: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/tag-label.json"
));

/// T3 共享向量:整条标签路径的界面口径合法性(前端 `src/shared/tag-path-valid.test.ts`
/// 读同一份文件喂给 `isValidTagPath`)。两侧任何一方改了路径口径,两条测试同时红。
const TAG_PATH_VALID: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/tag-path-valid.json"
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

/// 一条路径向量(`why` 是文档字段,断言不读)
#[derive(Deserialize)]
struct PathCase {
    path: String,
    valid: bool,
}

fn path_cases() -> Vec<PathCase> {
    serde_json::from_str(TAG_PATH_VALID).expect("fixtures/tag-path-valid.json 必须是合法 JSON 数组")
}

/// fixture 结构:条数达标,且确实有"md 名合法"的条目(否则放宽没被验到)
#[test]
fn fixture_tag_path_valid_is_well_formed() {
    let cases = path_cases();
    assert!(cases.len() >= 20, "共享向量至少 20 条,实际 {}", cases.len());
    assert!(
        cases.iter().any(|c| c.valid && c.path.contains("[郴]")),
        "向量里得有 md 名字合法的条目,否则放宽点没被验证"
    );
    assert!(cases.iter().any(|c| !c.valid), "也必须有非法条目");
}

/// T3 逐条:validate_tag_path(界面口径:筛选条件 + 改名门)与向量一致
#[test]
fn validate_tag_path_matches_shared_fixture() {
    for (i, c) in path_cases().iter().enumerate() {
        assert_eq!(
            validate_tag_path(&c.path).is_ok(),
            c.valid,
            "第 {i} 条路径判定不一致:{:?}",
            c.path
        );
    }
}

/// T3 与正文语法的分工:md 友好口径确实比 parse_tag_path 宽(放宽生效),
/// 但正文语法一个字未改(同一批名字 parse_tag_path 照样拒)。
#[test]
fn ui_path_syntax_is_relaxed_but_body_syntax_is_not() {
    for relaxed in ["地点/[郴](chēn)州市", "工作.", "日漫!"] {
        assert!(validate_tag_path(relaxed).is_ok(), "界面口径应放行:{relaxed}");
        assert!(crate::tags::parse_tag_path(relaxed).is_none(), "正文语法不得放宽:{relaxed}");
    }
    // 两份口径的公共部分:普通多级路径两边都收
    assert!(validate_tag_path("工作/项目A/会议").is_ok());
    assert!(crate::tags::parse_tag_path("工作/项目A/会议").is_some());
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

/// 界面改名校验:md 符号放行;空 / 含 `/` / 控制字符 / 空白 / `#` / 超长一律拒
#[test]
fn validate_label_allows_md_and_rejects_unusable_names() {
    for ok in [
        "[郴](chēn)州市",
        "**重点**",
        "*斜体*",
        "`代码`",
        "~~删除线~~",
        "_斜体_",
        "\\*字面星号",
        "工作",
        "项目A",
        "v1.0",
    ] {
        assert!(validate_label(ok).is_ok(), "应通过:{ok}");
    }
    assert!(validate_label("").is_err(), "空名");
    assert!(validate_label("a/b").unwrap_err().contains('/'), "路径分隔符必须拒");
    assert!(validate_label("a\nb").is_err(), "控制字符(换行)");
    assert!(validate_label("a\u{7}b").is_err(), "控制字符(BEL)");
    assert!(validate_label("a b").is_err(), "空白:正文语法永远到不了这种名字");
    assert!(validate_label("a#b").is_err(), "#:正文里会截断,名字不可引用");
    let max = "长".repeat(MAX_LABEL_CHARS);
    assert!(validate_label(&max).is_ok(), "恰好到上限应通过");
    let err = validate_label(&"长".repeat(MAX_LABEL_CHARS + 1)).unwrap_err();
    assert!(err.contains(&MAX_LABEL_CHARS.to_string()), "{err}");
}

/// T2 硬约束:正文 `#` 语法**一个字不改** —— 同一个 md 名字,界面能改,正文抽不到
#[test]
fn body_syntax_stays_strict_for_md_names() {
    for raw in ["[郴](chēn)州市", "**重点**", "`代码`", "a[b](c)d"] {
        assert!(crate::tags::parse_tag_path(raw).is_none(), "正文语法不得放宽:{raw}");
        assert!(validate_label(raw).is_ok(), "界面改名应接受:{raw}");
    }
    // 两侧都接受的普通单段名照旧
    assert_eq!(crate::tags::parse_tag_path("工作"), Some(vec!["工作".to_string()]));
    assert!(validate_label("工作").is_ok());
}
