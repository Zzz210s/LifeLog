//! 导出行为测试(自 notes_export.rs 拆出,守 200 行上限):
//! 排序/日期列(取自时间标签)/标签聚合/正文与标签的单元格截断边界
use super::*;
use crate::db::migrate;
use crate::db::repos::notes::{create_on, create_plain};
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

#[test]
fn export_notes_produces_xlsx_bytes() {
    let mut c = db();
    create_on(&mut c, "较早一条 #工作", "2026-08-01").unwrap();
    create_on(&mut c, "较新一条 #生活 #工作", "2026-09-15").unwrap();
    let bytes = export_notes(&c).unwrap();
    // xlsx 即 zip 容器:开头魔数 PK\x03\x04
    assert_eq!(&bytes[0..4], &[0x50, 0x4B, 0x03, 0x04]);
    assert!(bytes.len() > 1000);
}

#[test]
fn rows_are_ordered_dated_and_verbatim() {
    let mut c = db();
    create_on(&mut c, "较早一条 #工作", "2026-08-01").unwrap();
    create_on(&mut c, "    缩进首行\n第二行\n\n#生活 #工作", "2026-09-15").unwrap();
    create_on(&mut c, "无标签", "2026-09-16").unwrap();

    let rows = rows(&c).unwrap();
    let contents: Vec<&str> = rows.iter().map(|r| r.content.as_str()).collect();
    // 时间标签路径降序(同秒按 id 降序):最新在前
    assert_eq!(contents, vec!["无标签", "    缩进首行\n第二行\n\n", "较早一条"]);
    // 日期列取自时间标签,格式 YYYY-MM-DD
    assert_eq!(rows[0].date, "2026-09-16");
    assert_eq!(rows[1].date, "2026-09-15");
    assert_eq!(rows[2].date, "2026-08-01");
    // 标签聚合:按路径字典序升序(工作 < 时间排序 < 生活),时间标签一并在列内
    assert_eq!(rows[0].tags, "#时间排序/2026/09/16");
    assert_eq!(rows[1].tags, "#工作 #时间排序/2026/09/15 #生活");
    assert_eq!(rows[2].tags, "#工作 #时间排序/2026/08/01");
    // 最后修改列来自 updated_at,非空
    assert!(rows.iter().all(|r| !r.updated.is_empty()));
}

/// 无时间标签的笔记(回填后不应出现,如迁移跳过项)日期列留空,不借用 created_at
#[test]
fn tagless_note_has_empty_date_and_sorts_last() {
    let mut c = db();
    create_on(&mut c, "有日期", "2026-09-15").unwrap();
    create_plain(&mut c, "无时间标签").unwrap();

    let rows = rows(&c).unwrap();

    assert_eq!(rows[0].date, "2026-09-15");
    assert_eq!(rows[1].content, "无时间标签");
    assert_eq!(rows[1].date, "", "无时间标签留空");
    assert_eq!(rows[1].tags, "");
    assert!(export_notes(&c).is_ok());
}

#[test]
fn nested_tags_export_as_full_paths() {
    let mut c = db();
    // 不同父级下的同名末级:导出必须给完整路径,否则无法区分
    create_on(&mut c, "开会 #工作/项目A/会议", "2026-09-03").unwrap();
    create_on(&mut c, "开会 #生活/会议", "2026-09-02").unwrap();
    // 父级与子级同时挂:按路径升序聚合
    create_on(&mut c, "多层 #工作/项目A #工作", "2026-09-01").unwrap();
    let rows = rows(&c).unwrap();
    // 时间标签降序:最新在前,与创建顺序相反
    assert_eq!(rows[0].tags, "#工作/项目A/会议 #时间排序/2026/09/03");
    assert_eq!(rows[1].tags, "#时间排序/2026/09/02 #生活/会议");
    assert_eq!(rows[2].tags, "#工作 #工作/项目A #时间排序/2026/09/01");
}

#[test]
fn long_content_is_truncated_with_mark() {
    let mut c = db();
    create_on(&mut c, &"a".repeat(MAX_CELL_CHARS + 100), "2026-09-15").unwrap();

    let rows = rows(&c).unwrap();
    let cell = &rows[0].content;
    assert_eq!(cell.chars().count(), MAX_CELL_CHARS);
    assert!(cell.ends_with("…(导出已截断)"));
    assert!(cell.starts_with("aaaa"));
}

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

#[test]
fn overlong_tags_are_truncated_too() {
    // 标签列同一失效模式:聚合标签超上限时也必须截断而非让整库导出失败
    let mut c = db();
    create_on(&mut c, &format!("正文 #{}", "t".repeat(MAX_CELL_CHARS)), "2026-09-15").unwrap();

    let rows = rows(&c).unwrap();
    assert_eq!(rows[0].content, "正文");
    assert_eq!(rows[0].tags.chars().count(), MAX_CELL_CHARS);
    assert!(rows[0].tags.ends_with(TRUNCATE_MARK));
    assert!(export_notes(&c).is_ok());
}

#[test]
fn export_notes_survives_overlong_content() {
    let mut c = db();
    create_on(&mut c, &"b".repeat(MAX_CELL_CHARS + 50), "2026-09-15").unwrap();
    let bytes = export_notes(&c).unwrap();
    assert_eq!(&bytes[0..4], &[0x50, 0x4B, 0x03, 0x04]);
}
