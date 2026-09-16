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
fn describes_keyword_date_and_phrase() {
    assert_eq!(
        d(r#"#a AND date>=2026-09-01 AND "两个 词""#),
        "标签(含子级)a 且 日期不早于 2026-09-01 且 关键词「两个 词」"
    );
}
