//! 时间标签模板(spec 2026-09-17 D3/D5):时间标签已**降级为普通标签**,
//! 本模块不再有任何"时间子树"判定、SQL 片段或结构守卫 —— 只提供纯函数:
//! 模板校验与"模板 + 日期 -> 标签路径"的生成。
//! 默认模板 `时间排序/{y}/{m}/{d}`;生成结果的合法性以 `tags::parse_tag_path` 为唯一真源
//! (字符集、深度上限与正文抽标签同源),本模块不维护第二套标签语法。
use rusqlite::Connection;

/// 默认模板(设置键 `time_tag_template` 的初值与缺失回退值)
pub const DEFAULT_TEMPLATE: &str = "时间排序/{y}/{m}/{d}";

/// 模板必须包含的三个占位符(缺任一即非法)
const PLACEHOLDERS: [&str; 3] = ["{y}", "{m}", "{d}"];

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
        2 if y.is_multiple_of(4) && (!y.is_multiple_of(100) || y.is_multiple_of(400)) => 29,
        2 => 28,
        _ => 0,
    }
}

/// 占位符代入(纯字面替换;`date` 必须是已校验的 ISO 日期,故按字节切分安全)。
/// 未知占位符(如 `{x}`)原样保留,随后由 `parse_tag_path` 判非法。
fn render(template: &str, date: &str) -> String {
    template
        .replace("{y}", &date[0..4])
        .replace("{m}", &date[5..7])
        .replace("{d}", &date[8..10])
}

/// 模板校验:必须含 `{y}`/`{m}`/`{d}` 各至少一次,且代入样例日期后是**合法标签路径**。
/// 返回中文原因(设置页直接展示)或 `Ok(())`。
pub fn validate_template(template: &str) -> Result<(), String> {
    for ph in PLACEHOLDERS {
        if !template.contains(ph) {
            return Err(format!("模板必须包含 {ph}"));
        }
    }
    if crate::tags::parse_tag_path(&render(template, "2026-01-02")).is_none() {
        return Err(format!(
            "模板生成的标签路径不合法(名称可用中文/字母/数字/下划线/连字符,用 / 分层,最多 {} 级):{template}",
            crate::tags::max_depth()
        ));
    }
    Ok(())
}

/// `模板 + YYYY-MM-DD` -> 标签路径;
/// 模板不合法(缺 `{y}`/`{m}`/`{d}`、或生成结果不是合法标签路径)或日期非法时返回 None
/// (调用方据此降级为"本次不加自动标签")。
pub fn auto_time_path(template: &str, date: &str) -> Option<String> {
    validate_template(template).ok()?;
    if !is_iso_date(date) {
        return None;
    }
    let path = render(template, date);
    crate::tags::parse_tag_path(&path).map(|_| path)
}

/// 本地当天日期(`YYYY-MM-DD`)。取数据库的 localtime 口径,与库内其它时间来源一致
/// (created_at 的默认值同用 SQLite localtime)。
pub fn today_local(conn: &Connection) -> rusqlite::Result<String> {
    conn.query_row("SELECT date('now','localtime')", [], |r| r.get(0))
}

#[cfg(test)]
#[path = "timetag_tests.rs"]
mod timetag_tests;
