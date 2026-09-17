//! 词法测试(brief Step 1);位置断言为**字符下标**(Unicode 字符数)
use super::lexer::{lex, Token};

fn tag(path: &str, self_only: bool) -> Token {
    Token::Tag { path: path.into(), self_only }
}

#[test]
fn lexes_tag_keyword_operators_and_parens() {
    let toks = lex(r"(#工作 OR #生活) AND NOT #=临时 AND 复盘").unwrap();
    assert_eq!(
        toks,
        vec![
            Token::LParen,
            tag("工作", false),
            Token::Or,
            tag("生活", false),
            Token::RParen,
            Token::And,
            Token::Not,
            tag("临时", true),
            Token::And,
            Token::Keyword("复盘".into()),
        ]
    );
}

#[test]
fn lexes_symbolic_operators_and_quoted_phrase() {
    let toks = lex(r#"#a && !#b || "两个 词""#).unwrap();
    assert_eq!(
        toks,
        vec![
            tag("a", false),
            Token::And,
            Token::Not,
            tag("b", false),
            Token::Or,
            Token::Keyword("两个 词".into()),
        ]
    );
}

/// 日期比较已整体取消(spec 2026-09-17 D2):任何 `date` + 比较运算符都给中文报错,
/// 位置指向 `date` 首字符(而不是静默当关键词,让用户看不出所以然)
#[test]
fn date_comparisons_are_rejected_with_chinese_hint() {
    for src in [
        "date>=2026-09-01",
        "date >= 2026-09-01",
        "date<=2026-10-01",
        "date>2026-09-01",
        "date<2026-09-01",
        "date=2026-09-01",
    ] {
        let err = lex(src).unwrap_err();
        assert_eq!(err.message, "日期比较已取消,请用时间标签筛选", "{src}");
        assert_eq!(err.pos, 0, "{src}");
    }
}

/// 位置口径:`date` 之前的中文标签与空格各算一个字符,报错指向 `date` 首字符
#[test]
fn date_comparison_error_points_at_date_word() {
    let err = lex("#工作 AND date>=2026-09-01").unwrap_err();
    assert_eq!(err.message, "日期比较已取消,请用时间标签筛选");
    assert_eq!(err.pos, 8, "`#工作 AND ` 共 8 个字符:{err:?}");
}

/// 标签名内嵌标点的规则与 body 抽标签同一套(见 tags.rs):`#v1.0` 是**单个**标签 token
#[test]
fn lexes_tag_with_inner_punct_as_single_token() {
    assert_eq!(lex("#v1.0").unwrap(), vec![tag("v1.0", false)]);
    assert_eq!(lex("#=v1.0.1").unwrap(), vec![tag("v1.0.1", true)]);
}

/// 首尾标点非法:不静默切成「标签 + 关键词」,而是报标签路径不合法(位置指向 `#`)
#[test]
fn rejects_tag_with_dangling_punct() {
    let err = lex("#工作. 记录").unwrap_err();
    assert!(err.message.contains("路径"), "实际:{}", err.message);
    assert_eq!(err.pos, 0);
}

/// 单独出现的 `date` 仍是普通关键词(只有跟比较运算符时才报错)
#[test]
fn date_word_alone_is_a_keyword() {
    let toks = lex("date 记录").unwrap();
    assert_eq!(toks, vec![Token::Keyword("date".into()), Token::Keyword("记录".into())]);
}

/// `datex`/`database` 这类前缀词不是日期比较
#[test]
fn date_prefixed_words_are_keywords() {
    assert_eq!(lex("datex").unwrap(), vec![Token::Keyword("datex".into())]);
    assert_eq!(lex("database").unwrap(), vec![Token::Keyword("database".into())]);
}

#[test]
fn android_is_not_and_plus_word() {
    let toks = lex("android").unwrap();
    assert_eq!(toks, vec![Token::Keyword("android".into())]);
}

#[test]
fn reports_unclosed_quote_with_position() {
    let err = lex(r#"#a AND "未闭合"#).unwrap_err();
    assert_eq!(err.message, "引号没有闭合");
    // 修正:brief 手写期望 5 与实际不符 —— 开引号位于字符下标 7(`#a AND ` 共 7 个字符)。
    // 约定见 lexer.rs:pos 指向出错 token 首字符;此处若报 5 会指到 `AND` 的 `D`。
    assert_eq!(err.pos, 7);
}

#[test]
fn reports_bad_tag_path_with_position() {
    let err = lex("#工作//项目").unwrap_err();
    assert!(err.message.contains("路径"), "实际:{}", err.message);
    assert_eq!(err.pos, 0);
}
