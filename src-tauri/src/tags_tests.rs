//! 标签语法测试(spec 3.3.1 逐条):严格名称字符集、Markdown 写法区分、整串判定。
//! 自 tags.rs 拆出以守 200 行上限。
use super::*;

// ---- spec 3.3.1 逐条用例 ----

#[test]
fn plain_tag() {
    assert_eq!(extract_tags("今天#工作 很累"), vec!["工作"]);
}

#[test]
fn nested_path() {
    assert_eq!(extract_tags("#工作/项目A/会议"), vec!["工作/项目A/会议"]);
}

#[test]
fn heading_is_not_tag() {
    assert!(extract_tags("# 标题").is_empty());
}

#[test]
fn heading_with_tag_later() {
    assert_eq!(extract_tags("## 标题 #工作"), vec!["工作"]);
}

#[test]
fn double_hash_is_not_tag() {
    assert!(extract_tags("##标题").is_empty());
}

#[test]
fn ascii_word_prefix_is_not_tag() {
    assert!(extract_tags("abc#def").is_empty());
}

#[test]
fn csharp_is_not_tag() {
    assert!(extract_tags("我用 C# 写").is_empty());
}

#[test]
fn url_fragment_is_not_tag() {
    assert!(extract_tags("https://x.com/a#b 看这里").is_empty());
}

#[test]
fn html_entity_is_not_tag() {
    assert!(extract_tags("&#39; 引号").is_empty());
}

#[test]
fn escaped_is_not_tag() {
    assert!(extract_tags("\\#工作 不是标签").is_empty());
}

#[test]
fn inline_code_is_not_tag() {
    assert!(extract_tags("`#工作` 是代码").is_empty());
}

#[test]
fn fenced_code_is_not_tag() {
    assert!(extract_tags("```\n#工作\n```\n").is_empty());
}

#[test]
fn punctuation_terminates() {
    assert_eq!(extract_tags("#工作,然后"), vec!["工作"]);
}

#[test]
fn empty_segment_invalid() {
    assert!(extract_tags("#a//b").is_empty());
}

#[test]
fn trailing_slash_invalid() {
    assert!(extract_tags("#a/ 结束").is_empty());
}

#[test]
fn too_deep_invalid() {
    assert!(extract_tags("#a/b/c/d/e/f").is_empty());
}

#[test]
fn space_terminates_nested_path() {
    // 修复轮 1:空白不再导致整串作废,只正常终止标签;其后文字留在正文
    assert_eq!(extract_tags("#工作/项目 A"), vec!["工作/项目"]);
    assert_eq!(
        extract_tags("#工作/项目A/会议 记录"),
        vec!["工作/项目A/会议"]
    );
}

#[test]
fn punctuation_terminates_nested_path() {
    // 修复轮 1:标点同样只是正常终止(`#工作,然后` 与 `#a/b,然后` 同理)
    assert_eq!(extract_tags("#a/b,然后"), vec!["a/b"]);
    assert_eq!(extract_tags("#工作 项目"), vec!["工作"]);
}

#[test]
fn structurally_invalid_paths_are_void() {
    // 仅结构非法才整串丢弃:斜杠后无名称字符(段未闭合)、空段、深度超限
    assert!(extract_tags("#工作/").is_empty());
    assert!(extract_tags("#工作/ 结束").is_empty());
    assert!(extract_tags("#工作/项目/").is_empty());
    assert!(extract_tags("#/工作").is_empty());
    assert!(extract_tags("#a//b").is_empty());
    assert!(extract_tags("#a/b/c/d/e/f").is_empty());
}

#[test]
fn full_width_hash_is_not_tag() {
    assert!(extract_tags("＃工作").is_empty());
}

#[test]
fn full_path_returned_for_dedup() {
    assert_eq!(extract_tags("#a/b #a/b"), vec!["a/b"]);
}

// ---- 语法边界补充用例 ----

#[test]
fn name_charset_excludes_dot_and_middle_dot() {
    // 新字符集不再含 `.` 与 `·`:它们终止标签,标签名只留前面的合法部分
    assert_eq!(
        extract_tags("看完 #流浪地球 特效不错 #sci-fi"),
        vec!["流浪地球", "sci-fi"]
    );
    assert_eq!(extract_tags("#a-b_c/d"), vec!["a-b_c/d"]);
    assert_eq!(extract_tags("#a·b"), vec!["a"]);
    assert_eq!(extract_tags("#a.b"), vec!["a"]);
}

#[test]
fn dedups_in_order() {
    assert_eq!(extract_tags("#a 先 #b 后 #a"), vec!["a", "b"]);
}

#[test]
fn stops_at_punct_and_space() {
    assert_eq!(extract_tags("#tag,rest #tag2。结束"), vec!["tag", "tag2"]);
}

#[test]
fn bare_hash_ignored() {
    assert!(extract_tags("# #! ##").is_empty());
}

#[test]
fn nested_path_may_be_followed_by_another_tag_or_line_end() {
    // 含 '/' 的 token 之后的空白后面若是另一个 '#' 或行尾,则是干净边界
    assert_eq!(extract_tags("#a/b #c/d"), vec!["a/b", "c/d"]);
    assert_eq!(extract_tags("#工作/项目A\n下一行"), vec!["工作/项目A"]);
}

#[test]
fn parse_tag_path_validates_segments_and_depth() {
    assert_eq!(parse_tag_path("工作"), Some(vec!["工作".to_string()]));
    assert_eq!(max_depth(), 5);
    assert!(parse_tag_path("").is_none());
    assert!(parse_tag_path("/a").is_none());
    assert!(parse_tag_path("a/").is_none());
    assert!(parse_tag_path("a//b").is_none());
    assert!(parse_tag_path("a/b/c/d/e").is_some());
    assert!(parse_tag_path("a/b/c/d/e/f").is_none());
    assert!(parse_tag_path("a b").is_none());
    assert!(parse_tag_path("a.b").is_none());
}

#[test]
fn is_tag_char_covers_spec_charset() {
    assert!(is_tag_char('工'));
    assert!(is_tag_char('a'));
    assert!(is_tag_char('7'));
    assert!(is_tag_char('_'));
    assert!(is_tag_char('-'));
    assert!(!is_tag_char('/'));
    assert!(!is_tag_char('.'));
    assert!(!is_tag_char('·'));
    assert!(!is_tag_char('，'));
    assert!(!is_tag_char(' '));
}
