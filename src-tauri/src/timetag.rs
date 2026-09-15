//! 时间标签(spec 2026-09-15 第 4 节):时间由标签 `时间排序/YYYY/MM/DD` 表达,深度 4。
//! created_at 列保留但零业务用途(D2):不显示、不排序、不筛选、不导出。
//! 时间标签由系统添加(保存时当天、迁移 008 按旧 created_at 回填);用户手打 `#时间排序/...`
//! 走普通标签解析,行为一致(不特殊拦截)。
//! 路径前缀一律用 substr 比较(标签名可能含 % 或 _,禁用 LIKE)。
use rusqlite::Connection;

/// 时间根标签名(固定,系统维护)
pub const TIME_ROOT: &str = "时间排序";

/// 是否属于时间子树(`时间排序` 自身或其 `时间排序/...` 后代)
pub fn is_time_path(path: &str) -> bool {
    match path.strip_prefix(TIME_ROOT) {
        Some(rest) => rest.is_empty() || rest.starts_with('/'),
        None => false,
    }
}

/// ISO 日期(`YYYY-MM-DD`)格式 + 基本日历合法性(闰年 2 月按公历判定)
pub fn is_iso_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    if !b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit()) {
        return false;
    }
    let num = |a: usize, z: usize| s[a..z].parse::<u32>().ok();
    match (num(0, 4), num(5, 7), num(8, 10)) {
        (Some(y), Some(m), Some(d)) => y >= 1 && (1..=12).contains(&m) && d >= 1 && d <= days_in_month(y, m),
        _ => false,
    }
}

/// 指定年月的天数
fn days_in_month(y: u32, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) => 29,
        2 => 28,
        _ => 0,
    }
}

/// `YYYY-MM-DD` -> `["时间排序", "YYYY", "MM", "DD"]`(供 ensure_path 建树);日期非法返回 None
pub fn segments_for_date(date: &str) -> Option<Vec<String>> {
    if !is_iso_date(date) {
        return None;
    }
    Some(vec![
        TIME_ROOT.to_string(),
        date[0..4].to_string(),
        date[5..7].to_string(),
        date[8..10].to_string(),
    ])
}

/// `YYYY-MM-DD` -> `时间排序/YYYY/MM/DD` 完整路径(日期范围筛选的边界);日期非法返回 None
pub fn path_for_date(date: &str) -> Option<String> {
    segments_for_date(date).map(|segs| segs.join("/"))
}

/// 时间标签路径 -> `YYYY-MM-DD`(非时间路径、或未到"日"级的节点如 `时间排序/2026/09` 返回 None)。
/// 深于四级的手打路径(`时间排序/2026/09/15/x`)取前三级作为日期。
pub fn date_from_path(path: &str) -> Option<String> {
    let rest = path.strip_prefix(TIME_ROOT)?.strip_prefix('/')?;
    let segs: Vec<&str> = rest.split('/').collect();
    if segs.len() < 3 {
        return None;
    }
    let date = format!("{}-{}-{}", segs[0], segs[1], segs[2]);
    is_iso_date(&date).then_some(date)
}

/// SQL 片段:`<alias>.path` 是否属于时间子树(前缀 substr 比较,参数由调用方给)
pub fn sql_is_time_path(alias: &str) -> String {
    format!("substr({alias}.path, 1, length('{TIME_ROOT}') + 1) = '{TIME_ROOT}/'")
}

/// 本地当天日期(`YYYY-MM-DD`)。取数据库的 localtime 口径,与库内其它时间来源一致
/// (created_at 的默认值同用 SQLite localtime)。
pub fn today_local(conn: &Connection) -> rusqlite::Result<String> {
    conn.query_row("SELECT date('now','localtime')", [], |r| r.get(0))
}

#[cfg(test)]
#[path = "timetag_tests.rs"]
mod timetag_tests;
