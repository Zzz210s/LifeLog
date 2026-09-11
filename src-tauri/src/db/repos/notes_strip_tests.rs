//! strip_tags 行为测试(自 notes_tests.rs 拆出):标签剥离语义不回归 + 行结构/缩进保留
use super::strip_tags;

#[test]
fn strips_tags_but_keeps_line_indent() {
    assert_eq!(strip_tags("  - 任务 #tag"), "  - 任务");
    assert_eq!(strip_tags("完成 #a 收尾 #b"), "完成 收尾");
}

#[test]
fn leading_tag_leaves_no_residual_space() {
    assert_eq!(strip_tags("#电影 神作"), "神作");
    assert_eq!(strip_tags("#a #b 正文"), "正文");
    assert_eq!(strip_tags("#a\t正文"), "正文");
}

#[test]
fn mid_word_hash_keeps_separator() {
    // '#' 位于词中间(issue#123、URL 片段)时剥离标签不得吞掉后随空白,否则相邻词会粘连
    assert_eq!(strip_tags("issue#123 修复"), "issue 修复");
    assert_eq!(strip_tags("a#tag b"), "a b");
    assert_eq!(strip_tags("见 https://x.com#sec 结束"), "见 https://x.com 结束");
}

#[test]
fn punctuation_before_tag_keeps_separator() {
    // 标点后的标签不得吞并其后的分隔空白:一旦吞掉,两侧文本会粘连成一个词,语义被改
    assert_eq!(strip_tags("版本(#v2 备注)"), "版本( 备注)");
    assert_eq!(strip_tags("a.#tag b"), "a. b");
    assert_eq!(strip_tags("a-#tag b"), "a- b");
}

#[test]
fn leading_tag_swallows_all_following_blanks() {
    // 行首标签后吞掉连续空白/制表符,不留残余空白当缩进;但不吞换行(否则下一行会被并上来)
    assert_eq!(strip_tags("#a  正文"), "正文");
    assert_eq!(strip_tags("#a\t\t正文"), "正文");
    assert_eq!(strip_tags("#a \t正文"), "正文");
    assert_eq!(strip_tags("#a \t\n正文"), "\n正文");
}

#[test]
fn preserves_nested_list_indent() {
    let src = "- 一级\n  - 二级\n    - 三级 #标签";
    assert_eq!(strip_tags(src), "- 一级\n  - 二级\n    - 三级");
}

#[test]
fn preserves_indent_inside_fenced_code() {
    let src = "```ts\n  const a = 1;\n    if (a) {}\n```";
    assert_eq!(strip_tags(src), src);
}

#[test]
fn preserves_leading_tabs() {
    let src = "标题\n\t缩进一\n\t\t缩进二";
    assert_eq!(strip_tags(src), src);
}

#[test]
fn blank_lines_stay_blank() {
    // 纯空白行归一为空行(行首空白对空行无意义)
    assert_eq!(strip_tags("上\n\n下\n   \n末"), "上\n\n下\n\n末");
}

#[test]
fn collapses_inner_runs_and_trims_line_ends() {
    assert_eq!(strip_tags("a   b\tc   "), "a b c");
    assert_eq!(strip_tags("前  后 #t"), "前 后");
}

#[test]
fn normalizes_crlf_and_keeps_indent() {
    let src = "- 一\r\n  - 二\r\n\r\n尾";
    assert_eq!(strip_tags(src), "- 一\n  - 二\n\n尾");
}
