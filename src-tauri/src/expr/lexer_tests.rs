//! 词法测试(brief Step 1);位置断言为**字符下标**(Unicode 字符数)
use super::ast::DateOp;
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

#[test]
fn lexes_date_comparisons() {
    let toks = lex("date>=2026-09-01 AND date<2026-10-01").unwrap();
    assert_eq!(
        toks,
        vec![
            Token::Date { op: DateOp::Ge, date: "2026-09-01".into() },
            Token::And,
            Token::Date { op: DateOp::Lt, date: "2026-10-01".into() },
        ]
    );
}

/// 运算符**两侧**都允许空白(容忍度对称)
#[test]
fn date_operator_may_be_followed_by_space() {
    let toks = lex("date >= 2026-09-01").unwrap();
    assert_eq!(toks, vec![Token::Date { op: DateOp::Ge, date: "2026-09-01".into() }]);
}

/// 只跳过运算符后的空白、不跳运算符前的,同样能过
#[test]
fn date_operator_tolerates_space_before_literal() {
    let toks = lex("date>= 2026-09-01").unwrap();
    assert_eq!(toks, vec![Token::Date { op: DateOp::Ge, date: "2026-09-01".into() }]);
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

#[test]
fn date_word_alone_is_a_keyword() {
    let toks = lex("date 记录").unwrap();
    assert_eq!(toks, vec![Token::Keyword("date".into()), Token::Keyword("记录".into())]);
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

#[test]
fn reports_bad_date_with_position() {
    let err = lex("date>=2026-13-45").unwrap_err();
    assert_eq!(err.message, "日期格式不正确(应为 YYYY-MM-DD)");
    // 修正:brief 手写期望 5 忽略了 `>=` 占两个字符;日期字面量自字符下标 6 开始。
    assert_eq!(err.pos, 6);
}
