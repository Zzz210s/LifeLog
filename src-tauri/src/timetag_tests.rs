//! timetag 纯函数测试(spec 2026-09-17 D5):模板校验与"模板 + 日期 -> 标签路径"生成。
//! 时间标签降级为普通标签后,本模块不再有子树判定/守卫;合法性真源是 tags::parse_tag_path。
use super::*;

#[test]
fn iso_date_accepts_real_dates_and_rejects_others() {
    assert!(is_iso_date("2026-09-15"));
    assert!(is_iso_date("2024-02-29"), "闰年 2 月 29 合法");
    for bad in ["2026-9-15", "26-09-15", "2026/09/15", "2025-02-29", "2026-13-01", "2026-00-10", "坏的", ""] {
        assert!(!is_iso_date(bad), "{bad} 应被拒绝");
    }
}

#[test]
fn auto_time_path_renders_default_template() {
    assert_eq!(
        auto_time_path(DEFAULT_TEMPLATE, "2026-09-15").as_deref(),
        Some("时间排序/2026/09/15")
    );
    assert_eq!(auto_time_path("{y}{m}{d}", "2026-01-02").as_deref(), Some("20260102"));
    assert_eq!(auto_time_path("日期/{y}/{m}/{d}/旧", "2025-12-31").as_deref(), Some("日期/2025/12/31/旧"));
}

#[test]
fn auto_time_path_rejects_bad_dates_and_bad_templates() {
    assert_eq!(auto_time_path(DEFAULT_TEMPLATE, "2026-13-01"), None, "日期非法");
    assert_eq!(auto_time_path("时间排序/{y}/{m}", "2026-09-15"), None, "缺 {{d}}");
    assert_eq!(auto_time_path("时间/{y}/{m}/{d}!", "2026-09-15"), None, "生成结果不是合法标签路径");
    assert_eq!(auto_time_path("x/{y}/{m}/{d}/{y}/z", "2026-09-15"), None, "超过深度上限");
}

#[test]
fn validate_template_accepts_required_placeholders() {
    assert!(validate_template(DEFAULT_TEMPLATE).is_ok());
    assert!(validate_template("{y}-{m}-{d}").is_ok());
    assert!(validate_template("归档/{y}/{m}/{d}").is_ok());
}

#[test]
fn validate_template_reports_chinese_reasons() {
    assert_eq!(validate_template("时间排序/{m}/{d}").unwrap_err(), "模板必须包含 {y}");
    assert_eq!(validate_template("时间排序/{y}/{d}").unwrap_err(), "模板必须包含 {m}");
    assert_eq!(validate_template("时间排序/{y}/{m}").unwrap_err(), "模板必须包含 {d}");
    let bad = validate_template("时间排序/{y}/{m}/{d}!").unwrap_err();
    assert!(bad.contains("不合法"), "{bad}");
    let deep = validate_template("{y}/{m}/{d}/a/b/c").unwrap_err();
    assert!(deep.contains("不合法"), "{deep}");
}

#[test]
fn today_local_is_iso_date() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    let today = today_local(&conn).unwrap();
    assert!(is_iso_date(&today), "本地当天应是 ISO 日期:{today}");
}
