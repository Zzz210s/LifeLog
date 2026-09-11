//! 导出行为测试(自 notes_export.rs 拆出,守 200 行上限):
//! 排序/标签聚合/正文与标签的单元格截断边界
use super::*;
use crate::db::migrate;
use crate::db::repos::notes;
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

#[test]
fn export_notes_produces_xlsx_bytes() {
    let mut c = db();
    notes::create(&mut c, "较早一条 #工作").unwrap();
    notes::create(&mut c, "较新一条 #生活 #工作").unwrap();
    let bytes = export_notes(&c).unwrap();
    // xlsx 即 zip 容器:开头魔数 PK\x03\x04
    assert_eq!(&bytes[0..4], &[0x50, 0x4B, 0x03, 0x04]);
    assert!(bytes.len() > 1000);
}

#[test]
fn rows_are_ordered_tagged_and_verbatim() {
    let mut c = db();
    notes::create(&mut c, "较早一条 #工作").unwrap();
    notes::create(&mut c, "    缩进首行\n第二行\n\n#生活 #工作").unwrap();
    notes::create(&mut c, "无标签").unwrap();

    let rows = rows(&c).unwrap();
    let contents: Vec<&str> = rows.iter().map(|r| r.content.as_str()).collect();
    // created_at DESC(同秒按 id DESC):最新在前
    assert_eq!(contents, vec!["无标签", "    缩进首行\n第二行\n\n", "较早一条"]);
    // 标签聚合:多标签名升序、无标签为空串
    assert_eq!(rows[0].tags, "");
    assert_eq!(rows[1].tags, "#工作 #生活");
    assert_eq!(rows[2].tags, "#工作");
    // 创建时间列稳定降序
    assert!(rows[0].created >= rows[1].created);
    assert!(rows[1].created >= rows[2].created);
}

#[test]
fn long_content_is_truncated_with_mark() {
    let mut c = db();
    notes::create(&mut c, &"a".repeat(MAX_CELL_CHARS + 100)).unwrap();

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
    notes::create(&mut c, &format!("正文 #{}", "t".repeat(MAX_CELL_CHARS))).unwrap();

    let rows = rows(&c).unwrap();
    assert_eq!(rows[0].content, "正文");
    assert_eq!(rows[0].tags.chars().count(), MAX_CELL_CHARS);
    assert!(rows[0].tags.ends_with(TRUNCATE_MARK));
    assert!(export_notes(&c).is_ok());
}

#[test]
fn export_notes_survives_overlong_content() {
    let mut c = db();
    notes::create(&mut c, &"b".repeat(MAX_CELL_CHARS + 50)).unwrap();
    let bytes = export_notes(&c).unwrap();
    assert_eq!(&bytes[0..4], &[0x50, 0x4B, 0x03, 0x04]);
}
