//! S2 的日标签谓词、读数与查询助手(自 `s2_created_at.rs` 拆出以守 200 行上限)。
//! 事务内自对账也在这里:`self_check` 只信前像与实际读数,失败即让调用方回滚。
use super::s1_sql::NOTE_PREDICATE;
use super::s2_created_at::{Hit, Plan};
use super::Failure;
use rusqlite::Connection;
use std::collections::BTreeMap;

/// 日标签谓词(spec §7.1 逐字;兼容 `时间/{y}/{m}/{d}` 与 `时间/日期/{y}/{m}/{d}`)
pub(crate) const DAY_TAG_GLOB: &str =
    "(t.path GLOB '时间/[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9]'
  OR t.path GLOB '时间/日期/[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9]')";

/// 关键读数(与 S1 同一套口径;S2 前后必须逐值相同)
pub fn readings(conn: &Connection) -> Result<super::s1_sql::Readings, Failure> {
    super::s1_sql::readings(conn).map_err(|e| Failure::check(e.to_string()))
}

/// 该命中的 `created_at` 日期部分本已等于日标签日期(只把时分秒归零)
pub(crate) fn is_same_day(h: &Hit) -> bool {
    h.old.get(..10) == Some(h.day.as_str())
}

/// 全部笔记的 `(id, created_at)`,按 id 升序
pub(crate) fn all_notes(conn: &Connection) -> rusqlite::Result<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT p.id, p.created_at FROM points p WHERE {NOTE_PREDICATE} ORDER BY p.id"
    ))?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

/// 有日标签的笔记 -> 其全部日标签路径(按 id、路径升序)
pub(crate) fn day_tags(conn: &Connection) -> rusqlite::Result<BTreeMap<i64, Vec<String>>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT p.id, t.path FROM points p
           JOIN lines e ON e.from_id = p.id AND (e.name_id IS NULL OR e.name_id <> 0)
           JOIN points t ON t.id = e.to_id
          WHERE {NOTE_PREDICATE} AND {DAY_TAG_GLOB}
          ORDER BY p.id, t.path"
    ))?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    let mut map: BTreeMap<i64, Vec<String>> = BTreeMap::new();
    for row in rows {
        let (id, path) = row?;
        map.entry(id).or_default().push(path);
    }
    Ok(map)
}

/// 路径末三段拼 `y-m-d`;拼不出合法日历日期返回 None
pub(crate) fn day_of(path: &str) -> Option<String> {
    let mut it = path.rsplit('/');
    let d = it.next()?;
    let m = it.next()?;
    let y = it.next()?;
    if !valid_date(y, m, d) {
        return None;
    }
    Some(format!("{y}-{m}-{d}"))
}

/// 严格日历校验(不做 SQLite `date()` 那类归一化):`{y}` 四位、`{m}`/`{d}` 两位且真合法
fn valid_date(y: &str, m: &str, d: &str) -> bool {
    if y.len() != 4 || m.len() != 2 || d.len() != 2 {
        return false;
    }
    if !y
        .bytes()
        .chain(m.bytes())
        .chain(d.bytes())
        .all(|b| b.is_ascii_digit())
    {
        return false;
    }
    let (y, m, d) = (
        y.parse::<i32>().unwrap(),
        m.parse::<i32>().unwrap(),
        d.parse::<i32>().unwrap(),
    );
    if !(1..=12).contains(&m) || d < 1 {
        return false;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let dim = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        _ => 0,
    };
    d <= dim
}

/// 事务内自对账:关键读数逐值不变 + 全部笔记逐篇核对(命中者 == 新值,其余 == 前像)
pub(crate) fn self_check(conn: &Connection, plan: &Plan) -> Result<Vec<String>, Failure> {
    let post = readings(conn)?;
    if post != plan.pre {
        return Err(Failure::check(format!(
            "S2 自对账失败:读数变了 前 {:?} / 后 {:?}",
            plan.pre, post
        )));
    }
    let hits: BTreeMap<i64, &Hit> = plan.hits.iter().map(|h| (h.id, h)).collect();
    let mut changed = 0i64;
    for (id, old) in &plan.notes {
        let now: String = conn
            .query_row("SELECT created_at FROM points WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .map_err(check)?;
        match hits.get(id) {
            Some(h) => {
                if now != h.new {
                    return Err(Failure::check(format!(
                        "S2 自对账失败:笔记 {id} 期望 {} 实为 {now}",
                        h.new
                    )));
                }
                if now != *old {
                    changed += 1;
                }
            }
            None => {
                if now != *old {
                    return Err(Failure::check(format!(
                        "S2 自对账失败:无日标签笔记 {id} 被改动 {old} -> {now}"
                    )));
                }
            }
        }
    }
    let same = plan.hits.iter().filter(|h| is_same_day(h)).count();
    Ok(vec![
        format!(
            "S2 更新 {} 行 created_at(日期不变 {same}、会变 {}、不动 {})",
            plan.hits.len(),
            plan.hits.len() - same,
            plan.untouched
        ),
        format!(
            "S2 自对账:points/lines/points_fts/闭包/信息流默认筛选/entity_merge_log 逐值不变(命中 {changed} 行实际有变)"
        ),
    ])
}

fn check(e: impl ToString) -> Failure {
    Failure::check(e.to_string())
}
