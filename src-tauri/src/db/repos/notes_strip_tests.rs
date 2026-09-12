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
fn mid_word_hash_is_plain_text() {
    // spec 3.3.1 前导字符规则:'#' 前是 ASCII 字母数字时不视为标签 ->
    // 整段原样保留(既不剥离,也不吞掉其后的分隔空白;旧实现会剥成 "issue 修复")
    assert_eq!(strip_tags("issue#123 修复"), "issue#123 修复");
    assert_eq!(strip_tags("a#tag b"), "a#tag b");
    assert_eq!(strip_tags("见 https://x.com#sec 结束"), "见 https://x.com#sec 结束");
}

#[test]
fn invalid_tag_syntax_is_not_stripped() {
    // 不合法的 # 写法整串按文本保留,不做部分剥离
    assert_eq!(strip_tags("#/工作 正文"), "#/工作 正文");
    assert_eq!(strip_tags("#a//b 正文"), "#a//b 正文");
    assert_eq!(strip_tags("#a/ 结束"), "#a/ 结束");
    assert_eq!(strip_tags("#a/b/c/d/e/f 深"), "#a/b/c/d/e/f 深");
    assert_eq!(strip_tags("##标题"), "##标题");
    assert_eq!(strip_tags("`#工作` 是代码"), "`#工作` 是代码");
    assert_eq!(strip_tags("\\#工作 不是标签"), "\\#工作 不是标签");
}

#[test]
fn nested_path_is_stripped_at_clean_boundary() {
    // 行尾/换行是干净边界:多层标签正常剥离
    assert_eq!(strip_tags("#工作/项目A/会议"), "");
    assert_eq!(strip_tags("#工作/项目A/会议\n记录"), "\n记录");
    assert_eq!(strip_tags("记录 备注\n#工作/项目A/会议"), "记录 备注\n");
}

#[test]
fn nested_path_terminates_at_space() {
    // 修复轮 1:空白与标点只终止标签,标签照常剥离,其后正文原样保留
    assert_eq!(strip_tags("#工作/项目 A"), "A");
    assert_eq!(strip_tags("#a/b,然后"), ",然后");
    assert_eq!(strip_tags("#工作/项目A/会议 记录"), "记录");
    assert_eq!(strip_tags("记录 #工作/项目A 完成"), "记录 完成");
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

#[test]
fn trailing_tag_line_leaves_short_content_newline_terminated() {
    // 数据层半边(与导出/展示侧的往返一致):末行为纯标签行时,该行剥空,
    // 内容以 \n 结尾(即尾行标签不会把上一行拼上来,也不留残留空格)
    let src = "    const a = 1;\n    const b = 2;\n#x";
    assert_eq!(strip_tags(src), "    const a = 1;\n    const b = 2;\n");
}
