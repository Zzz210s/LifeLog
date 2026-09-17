//! 中文预览测试(brief Step 1):断言逐字文案,含全角括号与连接词空格
use super::describe::describe;
use super::parser::parse;

fn d(s: &str) -> String {
    describe(&parse(s).unwrap())
}

#[test]
fn describes_nested_expression() {
    assert_eq!(
        d("(#工作 OR #=生活) AND NOT #临时"),
        "（标签(含子级)工作 或 标签(仅本级)生活）且 非 标签(含子级)临时"
    );
}

#[test]
fn describes_keyword_and_phrase() {
    assert_eq!(
        d(r#"#a AND #b AND "两个 词""#),
        "标签(含子级)a 且 标签(含子级)b 且 关键词「两个 词」"
    );
}

/// 日期比较已取消(D2):预览层不再有日期说法(解析阶段即报错,进不了 describe)
#[test]
fn date_comparison_is_rejected_before_describe() {
    assert!(parse("date>=2026-09-01").is_err());
}
