//! `validate_expr` 命令的形状测试:合法给预览、非法给原因与 0 起字符位置、空白视为空。
use super::*;

#[test]
fn validate_expr_reports_ok_with_preview() {
    let r = validate_expr("#工作 AND NOT #临时".into());
    assert!(r.ok);
    assert_eq!(r.preview, "标签(含子级)工作 且 非 标签(含子级)临时");
    assert_eq!(r.message, "");
}

#[test]
fn validate_expr_reports_error_position() {
    let r = validate_expr("#工作 AND".into());
    assert!(!r.ok);
    assert_eq!(r.message, "缺少操作数");
    assert_eq!(r.position, 7);
    assert_eq!(r.preview, "");
}

#[test]
fn validate_expr_treats_blank_as_empty_error() {
    let r = validate_expr("   ".into());
    assert!(!r.ok);
    assert_eq!(r.message, "表达式为空");
    assert_eq!(r.position, 0);
    assert_eq!(r.preview, "");
}

/// 位置口径:0 起字符下标(BMP 外字符按 1 个字符计),前端串内错误 +1 后是「第 N 个字符」
#[test]
fn validate_expr_position_counts_chars_not_bytes() {
    let r = validate_expr("\u{1F600} AND".into());
    assert!(!r.ok);
    assert_eq!(r.position, 5, "代理对按 1 个字符计,位置不是字节偏移(字节会是 8)");
}
