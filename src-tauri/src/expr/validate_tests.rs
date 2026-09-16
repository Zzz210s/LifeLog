//! 校验测试(brief Step 1);超限用例只断言错误文案,位置断言留给词法/语法测试
use super::validate::validate;
use super::MAX_LEN;

#[test]
fn rejects_too_long_expression() {
    let long = "#a".to_string() + &" AND #a".repeat(100);
    let err = validate(&long).unwrap_err();
    assert_eq!(err.message, format!("表达式最多 {MAX_LEN} 字符"));
}

/// 101 个项但长度必须留在上限内,否则先被长度检查短路(见 task 报告「必要偏差」):
/// 用单字符裸词 + 空格分隔,共 201 字符、101 个 token
#[test]
fn rejects_too_many_tokens() {
    let many = std::iter::repeat("a").take(101).collect::<Vec<_>>().join(" ");
    assert!(many.chars().count() <= MAX_LEN, "用例本身需短于长度上限:{many}");
    let err = validate(&many).unwrap_err();
    assert_eq!(err.message, "表达式项数超过上限 100");
}

#[test]
fn accepts_normal_expression() {
    assert!(validate("(#工作 OR #生活) AND NOT #临时").is_ok());
}

/// 空引号短语:语法合法但永远查不到,必须拦掉(位置 0 起,指向开引号)
#[test]
fn rejects_empty_quoted_phrase() {
    let err = validate("\"\"").unwrap_err();
    assert_eq!(err.message, "引号内不能为空");
    assert_eq!(err.pos, 0);
}

/// 纯空白短语同样拦掉,位置取该短语 token 的首字符下标(0 起)
#[test]
fn rejects_blank_quoted_phrase_with_position() {
    let err = validate("#a AND \"   \"").unwrap_err();
    assert_eq!(err.message, "引号内不能为空");
    assert_eq!(err.pos, 7, "开引号位于字符下标 7:{err:?}");
}

#[test]
fn empty_is_an_error() {
    assert_eq!(validate("  ").unwrap_err().message, "表达式为空");
}

/// 语法错误必须原样透传 parser 的中文文案与字符下标
#[test]
fn syntax_error_passes_through_with_char_position() {
    let err = validate("#工作 AND").unwrap_err();
    assert_eq!(err.message, "缺少操作数");
    assert_eq!(err.pos, 7, "中文标签也算一个字符,位置指向末尾:{err:?}");
}
