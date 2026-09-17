//! 语法测试(brief Step 5);位置断言为**字符下标**(Unicode 字符数)
//! 日期比较已取消(D2),叶子只有标签 / 关键词 / 引号短语。
use super::ast::Expr;
use super::parser::parse;

fn tag(path: &str) -> Expr {
    Expr::Tag { path: path.into(), self_only: false }
}

#[test]
fn and_binds_tighter_than_or() {
    // 工作 OR 生活 AND todo  ==  工作 OR (生活 AND todo)
    let e = parse("#工作 OR #生活 AND #todo").unwrap();
    assert_eq!(
        e,
        Expr::Or(Box::new(tag("工作")), Box::new(Expr::And(Box::new(tag("生活")), Box::new(tag("todo")))))
    );
}

#[test]
fn parens_override_precedence() {
    let e = parse("(#工作 OR #生活) AND #todo").unwrap();
    assert_eq!(
        e,
        Expr::And(Box::new(Expr::Or(Box::new(tag("工作")), Box::new(tag("生活")))), Box::new(tag("todo")))
    );
}

#[test]
fn not_is_right_associative_and_strongest() {
    let e = parse("NOT NOT #工作 AND #todo").unwrap();
    assert_eq!(
        e,
        Expr::And(Box::new(Expr::Not(Box::new(Expr::Not(Box::new(tag("工作")))))), Box::new(tag("todo")))
    );
}

#[test]
fn parses_self_only_and_keyword() {
    let e = parse(r#"#=工作 AND "两个 词""#).unwrap();
    assert_eq!(
        e,
        Expr::And(
            Box::new(Expr::Tag { path: "工作".into(), self_only: true }),
            Box::new(Expr::Keyword("两个 词".into())),
        )
    );
}

/// 日期比较在语法入口同样被拦(词法阶段给中文报错,不会进 AST)
#[test]
fn rejects_date_comparison_with_chinese_hint() {
    let err = parse("date>=2026-09-01").unwrap_err();
    assert_eq!(err.message, "日期比较已取消,请用时间标签筛选");
    assert_eq!(err.pos, 0);
}

#[test]
fn reports_missing_operand() {
    let err = parse("#工作 AND").unwrap_err();
    assert_eq!(err.message, "缺少操作数");
    assert_eq!(err.pos, 7);
}

#[test]
fn reports_missing_close_paren() {
    let err = parse("(#工作 OR #生活").unwrap_err();
    assert_eq!(err.message, "缺少右括号");
}

#[test]
fn reports_extra_close_paren() {
    let err = parse("#工作)").unwrap_err();
    assert_eq!(err.message, "多余的右括号");
    assert_eq!(err.pos, 3);
}

#[test]
fn reports_empty_expression() {
    assert_eq!(parse("   ").unwrap_err().message, "表达式为空");
}

#[test]
fn reports_too_deep_nesting() {
    let expr = "(".repeat(11) + "#a" + &")".repeat(11);
    assert_eq!(parse(&expr).unwrap_err().message, "嵌套层数超过上限 10");
}
