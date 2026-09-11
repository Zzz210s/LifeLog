use crate::db::repos;
use crate::db::Db;
use tauri::{AppHandle, Manager, State};

/// YYYY-MM-DD 格式与月日合理性校验(免正则):
/// 长度 10、第 5/8 位为 '-'、其余为数字、月 1-12、日 1-31
fn valid_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    if !b.iter().enumerate().all(|(i, &c)| i == 4 || i == 7 || c.is_ascii_digit()) {
        return false;
    }
    let month: u32 = s[5..7].parse().unwrap_or(0);
    let day: u32 = s[8..10].parse().unwrap_or(0);
    (1..=12).contains(&month) && (1..=31).contains(&day)
}

#[tauri::command]
pub fn save_diary(
    app: AppHandle,
    date: String,
    title: String,
    content: String,
    mood: Option<String>,
    weather: Option<String>,
) -> Result<repos::diary::DiaryEntry, String> {
    if !valid_date(&date) {
        return Err("日期格式应为 YYYY-MM-DD".into());
    }
    let db: State<Db> = app.state();
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    repos::diary::upsert(&mut conn, &date, &title, &content, mood.as_deref(), weather.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_diary(
    app: AppHandle,
    date: String,
) -> Result<Option<repos::diary::DiaryEntry>, String> {
    if !valid_date(&date) {
        return Err("日期格式应为 YYYY-MM-DD".into());
    }
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(repos::diary::get_by_date(&conn, &date))
}

#[tauri::command]
pub fn diary_dates(app: AppHandle, year: i32, month: i32) -> Result<Vec<String>, String> {
    if !(1..=12).contains(&month) {
        return Err("月份应为 1-12".into());
    }
    let db: State<Db> = app.state();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(repos::diary::dates_in_month(&conn, year, month))
}

#[cfg(test)]
mod tests {
    use super::valid_date;

    #[test]
    fn accepts_canonical_form() {
        assert!(valid_date("2026-09-11"));
    }

    #[test]
    fn rejects_unpadded_parts() {
        assert!(!valid_date("2026-9-1"));
    }

    #[test]
    fn rejects_slash_separator() {
        assert!(!valid_date("2026/09/11"));
    }

    #[test]
    fn rejects_compact_digits() {
        assert!(!valid_date("20260911"));
    }

    #[test]
    fn rejects_month_13() {
        assert!(!valid_date("2026-13-01"));
    }

    #[test]
    fn rejects_month_00() {
        assert!(!valid_date("2026-00-10"));
    }

    #[test]
    fn rejects_day_32() {
        assert!(!valid_date("2026-09-32"));
    }

    #[test]
    fn rejects_alpha() {
        assert!(!valid_date("abc"));
    }

    #[test]
    fn rejects_empty() {
        assert!(!valid_date(""));
    }
}
