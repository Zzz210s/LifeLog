//! 解析真值表逐条用例(设计 §3.2 第 1-45 行):目标、名字、被剥掉的词元原文、剥离后正文。
//! 每行同时钉三处产品实现:`tag_spans_known`(词元区间)、`extract_lines_known`(目标 + 名字)、
//! `notes_parse::strip_tags`(正文残留)。`known`(库内已存在的路径)只有 md 路径与消歧两行用到。
use super::*;
use crate::db::repos::notes::strip_tags_known;

/// 一行真值:词元原文(按序)、目标 + 名字(None = 无名字)、剥离后的正文
fn check(src: &str, known: &[&str], tokens: &[&str], lines: &[(&str, Option<&str>)], body: &str) {
    let known: Vec<String> = known.iter().map(|s| (*s).to_string()).collect();
    let got: Vec<&str> = tag_spans_known(src, &known)
        .iter()
        .map(|s| &src[s.start..s.end])
        .collect();
    assert_eq!(got, tokens, "词元区间不符:{src:?}");
    let want: Vec<TagLine> = lines
        .iter()
        .map(|(p, n)| TagLine { path: (*p).to_string(), name: n.map(str::to_string) })
        .collect();
    assert_eq!(extract_lines_known(src, &known), want, "目标/名字不符:{src:?}");
    // 剥标签走的是保存路径的同一个入口(带同一份兜底候选)
    assert_eq!(strip_tags_known(src, &known), body, "正文残留不符:{src:?}");
}

/// 无兜底候选的行(绝大多数):`known` 为空
macro_rules! row {
    ($name:ident, $src:expr, [$($tok:expr),*], [$($line:expr),*], $body:expr) => {
        #[test]
        fn $name() {
            check($src, &[], &[$($tok),*], &[$($line),*], $body);
        }
    };
}

// ---- 名字组合法与命中(第 1-12 行) ----
row!(truth_table_row_1_relation_name, "#地点/中国大陆(国籍)",
    ["#地点/中国大陆(国籍)"], [("地点/中国大陆", Some("国籍"))], "");
row!(truth_table_row_2_no_group, "#地点/中国大陆",
    ["#地点/中国大陆"], [("地点/中国大陆", None)], "");
row!(truth_table_row_3_deep_path_with_name, "#a/b/c(名)",
    ["#a/b/c(名)"], [("a/b/c", Some("名"))], "");
row!(truth_table_row_4_leading_cjk, "今天#工作(重点) 很累",
    ["#工作(重点)"], [("工作", Some("重点"))], "今天 很累");
row!(truth_table_row_5_after_space, "词 #目标(名) 尾巴",
    ["#目标(名)"], [("目标", Some("名"))], "词 尾巴");
row!(truth_table_row_6_empty_group, "#目标()",
    ["#目标()"], [("目标", None)], "");
row!(truth_table_row_7_name_with_slash, "#目标(国籍/长期)",
    ["#目标(国籍/长期)"], [("目标", Some("国籍/长期"))], "");
row!(truth_table_row_8_name_with_inner_dot, "#目标(v1.0)",
    ["#目标(v1.0)"], [("目标", Some("v1.0"))], "");
row!(truth_table_row_9_name_with_dash, "#目标(状态-测试)",
    ["#目标(状态-测试)"], [("目标", Some("状态-测试"))], "");
row!(truth_table_row_10_extra_close_paren, "#目标(国籍))",
    ["#目标(国籍)"], [("目标", Some("国籍"))], ")");
row!(truth_table_row_11_text_after_group, "#目标(国籍)关系",
    ["#目标(国籍)"], [("目标", Some("国籍"))], "关系");
row!(truth_table_row_12_second_group_is_body, "#目标(甲)(乙)",
    ["#目标(甲)"], [("目标", Some("甲"))], "(乙)");

// ---- 组非法与未闭合:整串不认(第 13-17、21、22、40 行) ----
row!(truth_table_row_13_space_inside_group, "#目标( 国籍)",
    [], [], "#目标( 国籍)");
row!(truth_table_row_14_trailing_space_in_group, "#目标(国籍 )",
    [], [], "#目标(国籍 )");
row!(truth_table_row_15_hash_inside_group, "#目标(国#籍)",
    [], [], "#目标(国#籍)");
row!(truth_table_row_16_group_not_closed, "#目标(国籍",
    [], [], "#目标(国籍");
row!(truth_table_row_17_nested_open_paren, "#目标((名))",
    [], [], "#目标((名))");
row!(truth_table_row_21_trailing_dot_in_group, "#目标(国籍.",
    [], [], "#目标(国籍.");
row!(truth_table_row_22_backslash_in_group, "#目标(国籍\\)",
    [], [], "#目标(国籍\\)");
row!(truth_table_row_40_leading_dot_in_group, "#目标(.名)",
    [], [], "#目标(.名)");

// ---- 组必须紧贴路径(第 18-20 行) ----
row!(truth_table_row_18_space_breaks_group, "#目标 (国籍)",
    ["#目标"], [("目标", None)], "(国籍)");
row!(truth_table_row_19_newline_breaks_group, "#目标\n(国籍)",
    ["#目标"], [("目标", None)], "\n(国籍)");
row!(truth_table_row_20_full_width_paren, "#目标（国籍）",
    ["#目标"], [("目标", None)], "（国籍）");

// ---- 两法(严格 / 库内兜底)与 md 路径(第 23、24 行) ----
#[test]
fn truth_table_row_23_fallback_still_consumes_name_group() {
    // 严格扫描在 `[` 处失败,兜底最长匹配吃下整条 md 路径之后,最后那对括号才是名字组
    check(
        "#地点/中国大陆/湖南省/[郴](chēn)州市(国籍)",
        &["地点/中国大陆/湖南省/[郴](chēn)州市"],
        &["#地点/中国大陆/湖南省/[郴](chēn)州市(国籍)"],
        &[("地点/中国大陆/湖南省/[郴](chēn)州市", Some("国籍"))],
        "",
    );
}
row!(truth_table_row_24_unknown_md_path_is_void, "#地点/[郴](chēn)州市",
    [], [], "#地点/[郴](chēn)州市");
// 库内尚无该路径也照解析:建树与建名字点属保存语义(设计 §6)
row!(truth_table_row_25_target_absent_in_library, "#目标(国籍)",
    ["#目标(国籍)"], [("目标", Some("国籍"))], "");

// ---- 前导规则与代码/围栏(第 26-34 行) ----
row!(truth_table_row_26_ascii_letter_prefix, "C#目标(名)", [], [], "C#目标(名)");
row!(truth_table_row_27_url_fragment_prefix, "见 https://x/a#frag(名)",
    [], [], "见 https://x/a#frag(名)");
row!(truth_table_row_28_double_hash, "##标题(名)", [], [], "##标题(名)");
row!(truth_table_row_29_heading, "# 标题(名)", [], [], "# 标题(名)");
row!(truth_table_row_30_ascii_word_prefix, "abc#目标(名)", [], [], "abc#目标(名)");
row!(truth_table_row_31_escaped, "\\#目标(名)", [], [], "\\#目标(名)");
row!(truth_table_row_32_inline_code, "`#目标(名)`", [], [], "`#目标(名)`");
row!(truth_table_row_33_fenced_code, "```\n#目标(名)\n```\n",
    [], [], "```\n#目标(名)\n```\n");
row!(truth_table_row_34_invalid_path_no_fallback, "#a//b(名)", [], [], "#a//b(名)");

// ---- 字符面共存(第 35、36、39、41、43、44 行) ----
row!(truth_table_row_35_inside_wikilink, "[[#目标(名)]]",
    ["#目标(名)"], [("目标", Some("名"))], "[[]]");
row!(truth_table_row_36_bare_paren_without_hash, "工作(重要)", [], [], "工作(重要)");
row!(truth_table_row_39_slash_after_group, "#工作(重点)/子",
    ["#工作(重点)"], [("工作", Some("重点"))], "/子");
row!(truth_table_row_41_name_with_middle_dot, "#目标(名·字)",
    ["#目标(名·字)"], [("目标", Some("名·字"))], "");
row!(truth_table_row_43_line_start_swallows_space, "#目标(名) 尾巴",
    ["#目标(名)"], [("目标", Some("名"))], "尾巴");
row!(truth_table_row_44_adjacent_named_tokens, "#甲(名1)#乙(名2)",
    ["#甲(名1)", "#乙(名2)"], [("甲", Some("名1")), ("乙", Some("名2"))], "");

// ---- 消歧、表达式、别名(第 37、38、42、45 行) ----
#[test]
fn truth_table_row_37_bare_paren_label_disambiguated_by_constraint() {
    // 库内若有字面 `工作(重要)` 的标签就有两种读法 —— 该形态由设计的裸括号禁令排除(库内 0 例,
    // 约束与校验在标签名校验任务)。解析层判定确定:严格路径先命中 `工作`,兜底候选不参与。
    check("#工作(重要)", &["工作(重要)"], &["#工作(重要)"], &[("工作", Some("重要"))], "");
}

#[test]
fn truth_table_row_38_expression_read_tag_ignores_name_group() {
    // 表达式词法不消费名字组(N1,`scan_tag_path` 一字不改):`#目标` 是标签 token,
    // `(`/`)` 是括号 token、`名` 是关键词 —— 语法只有正文一处。
    use crate::expr::lexer::{lex, Token};
    assert_eq!(
        lex("#目标(名)").unwrap(),
        vec![
            Token::Tag { path: "目标".into(), self_only: false },
            Token::LParen,
            Token::Keyword("名".into()),
            Token::RParen,
        ]
    );
}

#[test]
fn truth_table_row_42_hash_without_name_char() {
    check("#(名字)", &[], &[], &[], "#(名字)");
    check("#()", &[], &[], &[], "#()");
}

#[test]
fn truth_table_row_45_alias_path_keeps_name() {
    // 名字组与别名解析正交:解析层只给写下的路径 + 名字;别名 -> 规范路径(`t.path`)在库侧
    // (`tags::link::resolve_paths`),回读给规范路径是既有往返口径,非本次引入。
    check("#别名文本(国籍)", &[], &["#别名文本(国籍)"], &[("别名文本", Some("国籍"))], "");
}
