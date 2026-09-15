//! 时间标签形态与日期解析测试(纯函数 + 本地当天取值)
use super::*;

fn segs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

#[test]
fn is_time_path_covers_root_and_descendants_only() {
    assert!(is_time_path("时间排序"));
    assert!(is_time_path("时间排序/2026"));
    assert!(is_time_path("时间排序/2026/09/15"));
    // 前缀相同但不是子树:兄弟标签不得误判
    assert!(!is_time_path("时间排序器"));
    assert!(!is_time_path("工作"));
    assert!(!is_time_path("工作/时间排序"));
    assert!(!is_time_path(""));
}

#[test]
fn segments_and_path_round_trip() {
    assert_eq!(segments_for_date("2026-09-15").unwrap(), segs(&["时间排序", "2026", "09", "15"]));
    assert_eq!(path_for_date("2026-09-15").unwrap(), "时间排序/2026/09/15");
    assert_eq!(date_from_path("时间排序/2026/09/15").unwrap(), "2026-09-15");
}

#[test]
fn invalid_dates_are_rejected() {
    for bad in ["2026-13-01", "2026-02-30", "26-01-01", "2026/09/15", "", "坏值"] {
        assert!(path_for_date(bad).is_none(), "{bad} 应被拒绝");
    }
    // 闰年 2 月 29 合法,平年不合法
    assert!(path_for_date("2024-02-29").is_some());
    assert!(path_for_date("2025-02-29").is_none());
}

#[test]
fn date_from_path_rejects_non_day_level_and_non_time_paths() {
    assert!(date_from_path("时间排序").is_none());
    assert!(date_from_path("时间排序/2026").is_none());
    assert!(date_from_path("时间排序/2026/09").is_none());
    assert!(date_from_path("时间排序/2026/13/01").is_none());
    assert!(date_from_path("工作/2026/09/15").is_none());
    // 深于四级的手打路径:取前三级
    assert_eq!(date_from_path("时间排序/2026/09/15/额外").unwrap(), "2026-09-15");
}

#[test]
fn sql_prefix_predicate_has_no_like_wildcard() {
    let frag = sql_is_time_path("t");
    assert!(frag.contains("substr(t.path, 1, length('时间排序') + 1) = '时间排序/'"));
    assert!(!frag.contains("LIKE"));
}

#[test]
fn today_local_is_iso_date() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    let today = today_local(&conn).unwrap();
    assert!(is_iso_date(&today), "本地当天应是 ISO 日期:{today}");
    // 与库内 created_at 默认值同一天(localtime 口径一致)
    let stamp: String = conn
        .query_row("SELECT date('now','localtime')", [], |r| r.get(0))
        .unwrap();
    assert_eq!(today, stamp);
}
/// SQL 片段是排序/筛选/导出的共同依据:必须与 Rust 判据逐例一致
/// (禁 LIKE,故用 substr 定长切片;非法日历日期靠 date() 往返相等判定)
#[test]
fn sql_predicates_agree_with_rust_judgements() {
    let conn = Connection::open_in_memory().unwrap();
    let day_sql = format!("SELECT COALESCE({}, 0) FROM (SELECT ?1 AS path) tt", sql_has_time_day("tt"));
    for path in [
        "时间排序/2026/09/15",
        "时间排序/2026/09/15/子级",
        "时间排序/2026/09/15x",
        "时间排序/2026/09",
        "时间排序/2026",
        "时间排序",
        "时间排序/2026/13/01",
        "时间排序/2026/02/30",
        "时间排序/2024/02/29",
        "时间排序/0000/01/01",
        "时间排序/2026/09/00",
        "工作/2026/09/15",
        "",
    ] {
        let got: bool = conn.query_row(&day_sql, [path], |r| r.get(0)).unwrap();
        assert_eq!(got, date_from_path(path).is_some(), "日级判定不一致:{path}");
    }
    let sub_sql = format!("SELECT COALESCE({}, 0) FROM (SELECT ?1 AS path) t", sql_in_time_subtree("t"));
    for path in ["时间排序", "时间排序/2026", "时间排序器", "工作", "工作/时间排序", ""] {
        let got: bool = conn.query_row(&sub_sql, [path], |r| r.get(0)).unwrap();
        assert_eq!(got, is_time_path(path), "子树判定不一致(裸根必须算):{path}");
    }
}

