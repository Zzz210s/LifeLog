//! 界面口径的**校验**用例:标签名(`validate_label`)/ 整条路径(`validate_tag_path`)/
//! 关系名(`validate_relation_name`)。
//! 路径共享向量 `fixtures/tag-path-valid.json` 与前端 `src/shared/tag-path-valid.test.ts`
//! 两侧共读:任一方改了路径口径,两条测试同时红。裸括号禁令(设计 §3.4)的谓词用例在
//! `tag_label_paren_tests.rs`,这里只验「校验入口确实拒/收」。
//! 解析口径(token 形态 / 纯文本)的用例在 `tag_label_tests.rs`。
use super::{validate_label, validate_relation_name, validate_tag_path, MAX_LABEL_CHARS};
use serde::Deserialize;

/// T3 共享向量:整条标签路径的界面口径合法性(前端 `src/shared/tag-path-valid.test.ts`
/// 读同一份文件喂给 `isValidTagPath`)。
const TAG_PATH_VALID: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/tag-path-valid.json"
));

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
    // T5 裸括号禁令的共享证据:新向量必须在表里且判非法;既有 md 向量必须继续判合法
    for p in ["工作(重要)", "(重点)", "a(b)c", "[郴](chēn)州市(别名)"] {
        assert!(cases.iter().any(|c| c.path == p && !c.valid), "裸括号向量缺失或判错:{p}");
    }
    for p in ["a[b](c)d/工作", "[郴](chēn)州市"] {
        assert!(cases.iter().any(|c| c.path == p && c.valid), "md 向量必须继续合法:{p}");
    }
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

/// T5 裸括号禁令(与前端 `tag-label-paren.test.ts` 同表):单段与整条路径都拒
#[test]
fn validate_label_and_path_reject_bare_parens() {
    for bad in ["工作(重要)", "(重点)", "a(b)c", "工作)", "工作(重点", "[郴](chēn)州市(别名)"] {
        let err = validate_label(bad).unwrap_err();
        assert!(err.contains("裸括号"), "{bad} => {err}");
        assert!(validate_tag_path(bad).is_err(), "整条路径也应拒:{bad}");
    }
    for ok in ["[郴](chēn)州市", "a[b](c)d", "**重点**", "`代码`", "工作"] {
        assert!(validate_label(ok).is_ok(), "应通过:{ok}");
    }
}

/// T5 关系名校验(P6):与正文语法**同源** —— 写得回 `#目标(名字)` 的才收
#[test]
fn validate_relation_name_follows_body_syntax() {
    for ok in ["国籍", "国籍/长期", "状态-测试", "v1.0", "工作·重点"] {
        assert!(validate_relation_name(ok).is_ok(), "应通过:{ok}");
        assert!(crate::tags::parse_tag_path(ok).is_some(), "正文也得认:{ok}");
    }
    for bad in ["国籍 地区", "国籍(旧)", "国#籍", "", "/a", "a/b/"] {
        assert!(validate_relation_name(bad).is_err(), "应拒:{bad}");
    }
    let err = validate_relation_name(&"长".repeat(MAX_LABEL_CHARS + 1)).unwrap_err();
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
