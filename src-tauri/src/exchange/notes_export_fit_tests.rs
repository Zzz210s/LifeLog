//! `fit_cell`(单元格截断)单元测试 —— 自 `notes_export_tests.rs` 拆出,守 200 行上限。
//! 口径:`<= MAX_CELL_CHARS` 原样放行,超长按字符数截断并在末尾标注(总长不超上限)。
use super::*;

#[test]
fn fit_cell_keeps_short_content_untouched() {
    assert_eq!(fit_cell("短正文\n    缩进"), "短正文\n    缩进");
}

#[test]
fn fit_cell_keeps_exactly_max_untouched() {
    // 边界闭合:恰好 MAX_CELL_CHARS 原样放行,与 crate 的 "> 上限才拒绝" 门禁对齐
    let exact = "x".repeat(MAX_CELL_CHARS);
    assert_eq!(fit_cell(&exact), exact);
}

#[test]
fn fit_cell_truncates_one_over_max_to_exact_max() {
    let over = "x".repeat(MAX_CELL_CHARS + 1);
    let out = fit_cell(&over);
    assert_ne!(out, over);
    assert_eq!(out.chars().count(), MAX_CELL_CHARS); // 截断后总长恰为上限(含标注)
    assert!(out.ends_with(TRUNCATE_MARK));
}
