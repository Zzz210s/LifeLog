//! 标签路径的字符集与结构判定测试(spec 3.3.1)。
//! 词元扫描(含关系名名字组)的用例在 tag_scan_tests.rs / tag_scan_truth_tests.rs —— 本文件只守
//! `tags.rs` 里留下的那两份真源:`is_tag_char`/`is_inner_punct` 字符集与 `parse_tag_path` 结构判定。
use super::*;

#[test]
fn parse_tag_path_validates_segments_only() {
    assert_eq!(parse_tag_path("工作"), Some(vec!["工作".to_string()]));
    assert!(parse_tag_path("").is_none());
    assert!(parse_tag_path("/a").is_none());
    assert!(parse_tag_path("a/").is_none());
    assert!(parse_tag_path("a//b").is_none());
    assert!(parse_tag_path("a/b/c/d/e").is_some());
    // 层级深度不设上限(2026-09-28):6 层、8 层都合法
    assert!(parse_tag_path("a/b/c/d/e/f").is_some());
    assert_eq!(parse_tag_path("a/b/c/d/e/f/g/h").map(|v| v.len()), Some(8));
    assert!(parse_tag_path("a b").is_none());
    // 小账 A:内部点可解析;首尾点/连续点仍非法
    assert_eq!(parse_tag_path("a.b"), Some(vec!["a.b".to_string()]));
    assert!(parse_tag_path("a.").is_none());
    assert!(parse_tag_path(".a").is_none());
    assert!(parse_tag_path("a..b").is_none());
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
    // `.`/`·` 属“内部标点”,由 valid_segment 控制位置而非名称字符
    assert!(is_inner_punct('.'));
    assert!(is_inner_punct('·'));
    assert!(!is_inner_punct('，'));
}

#[test]
fn scan_tag_path_rejects_invalid_and_reports_stop_index() {
    // 扫描器只走到第一个不符合的字符:合法返回 (路径, 尾后字符下标),结构非法返回 None
    let chars: Vec<char> = "工作/项目A 后续".chars().collect();
    assert_eq!(scan_tag_path(&chars, 0), Some(("工作/项目A".to_string(), 6)));
    let bad: Vec<char> = "a//b".chars().collect();
    assert_eq!(scan_tag_path(&bad, 0), None);
    // 名字组不是路径的一部分(路径扫描在 `(` 处停):`(` 之后的判定属 tag_name_group
    let paren: Vec<char> = "目标(国籍)".chars().collect();
    assert_eq!(scan_tag_path(&paren, 0), Some(("目标".to_string(), 2)));
}
