//! 名字组四态扫描器测试(设计 §3.3;真值表第 6、7-17、21、22、40 行的判定内核)。
//! 扫描对象是 `#路径` **之后**那一段;组内文本与路径共用 `tags` 的字符集与结构判定。
use super::*;

/// 在字符串**开头**消费一个名字组(`at = 0`)
fn at_start(input: &str) -> NameGroup {
    let chars: Vec<char> = input.chars().collect();
    consume_name_group(&chars, 0)
}

#[test]
fn absent_when_next_char_is_not_a_paren() {
    assert_eq!(at_start("目标"), NameGroup::Absent);
    assert_eq!(at_start("（国籍）"), NameGroup::Absent); // 全角括号不是名字组定界符
    assert_eq!(at_start(""), NameGroup::Absent);
    assert_eq!(at_start("(名)"), NameGroup::Named("名".into()));
}

#[test]
fn empty_group_is_legal_and_means_no_name() {
    assert_eq!(at_start("()"), NameGroup::Empty);
    // 组在第一个 ')' 处结束,后随文本不属于组
    assert_eq!(at_start("()尾巴"), NameGroup::Empty);
    assert_eq!(at_start("（)"), NameGroup::Absent); // 全角 `（` 不是起点
}

#[test]
fn named_group_shares_path_charset() {
    assert_eq!(at_start("(国籍)"), NameGroup::Named("国籍".into()));
    assert_eq!(at_start("(国籍/长期)"), NameGroup::Named("国籍/长期".into()));
    assert_eq!(at_start("(v1.0)"), NameGroup::Named("v1.0".into()));
    assert_eq!(at_start("(状态-测试)"), NameGroup::Named("状态-测试".into()));
    assert_eq!(at_start("(名·字)"), NameGroup::Named("名·字".into()));
    assert_eq!(at_start("(名)尾巴"), NameGroup::Named("名".into()));
}

#[test]
fn invalid_group_rejects_whole_token() {
    // 组非空但非法 / 未闭合:与 `#a//b` 同构,整串不认(不落部分结果)
    for bad in [
        "( 国籍)",   // 组内空白
        "(国籍 )",   // 组内空白
        "(国#籍)",   // `#` 不是名字字符
        "(国籍",     // 未闭合
        "((名))",    // 组内以 `(` 起头
        "(国籍.",    // 末尾 `.` 后无名称字符
        "(国籍\\)",  // 组内不支持转义
        "(.名)",     // 段首标点
        "(名/)",     // 段未闭合
        "(/名)",     // 首段为空
        "(名 字)",   // 组内空白
    ] {
        assert_eq!(at_start(bad), NameGroup::Invalid, "{bad}");
    }
}

#[test]
fn consumes_from_offset_without_touching_the_path() {
    // `at` 是 `(` 的下标:路径部分不参与消费(调用方已按路径推进)
    let chars: Vec<char> = "目标(国籍)".chars().collect();
    assert_eq!(consume_name_group(&chars, 2), NameGroup::Named("国籍".into()));
    assert_eq!(consume_name_group(&chars, 1), NameGroup::Absent); // 该处是 '标'
}

#[test]
fn invalid_group_skip_ends_after_the_offending_char() {
    // 整串不认时要跳过的文本:组内读掉的内容 + 让它停下的那个字符;
    // 停下处是 `)` 连它一起跳过,停在行尾则无可跳
    let skip = |s: &str| invalid_group_skip(&s.chars().collect::<Vec<_>>(), 0);
    assert_eq!(skip("(国#籍)"), 3); // 跳过 `国#`:组里的 `#` 不再被认成标签起点
    assert_eq!(skip("( 国籍)"), 2); // 跳过 ` `(不是该行的起点):组文本之后的扫描从 `国` 继续
    assert_eq!(skip("(名/)"), 4); // 停下处是 `)`(结构非法):连它一起跳过
    assert_eq!(skip("(国籍"), 3); // 未闭合停在行尾:无可跳
}
