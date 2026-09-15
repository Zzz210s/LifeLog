//! 改期(时间标签迁移)用例(spec 2026-09-15 第 4.2 节):解链旧时间标签、链到新日期、
//! 多标签收敛、非法日期被拒、同日幂等、普通标签不受影响。
use super::*;
use crate::db::migrate;
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn count(c: &Connection, sql: &str, params: &[&dyn rusqlite::ToSql]) -> i64 {
    c.query_row(sql, params, |r| r.get(0)).unwrap()
}

/// 该笔记的时间标签路径集合(路径升序)
fn time_paths(c: &Connection, id: i64) -> Vec<String> {
    let mut stmt = c
        .prepare(
            "SELECT t.path FROM tag_links l JOIN tags t ON t.id = l.tag_id
             WHERE l.target_type='note' AND l.target_id=?1
               AND substr(t.path, 1, length('时间排序') + 1) = '时间排序/' ORDER BY t.path",
        )
        .unwrap();
    let rows = stmt.query_map([id], |r| r.get(0)).unwrap();
    rows.map(|r| r.unwrap()).collect()
}

fn link_count(c: &Connection, id: i64) -> i64 {
    count(
        c,
        "SELECT COUNT(*) FROM tag_links WHERE target_type='note' AND target_id=?1",
        &[&id],
    )
}

#[test]
fn set_date_moves_time_tag_to_new_day() {
    let mut c = db();
    let n = create_on(&mut c, "改期正文 #工作", "2026-09-15").unwrap();

    let moved = set_date(&mut c, n.id, "2026-09-16").unwrap().unwrap();

    assert_eq!(moved.content, "改期正文", "正文不动");
    assert_eq!(moved.date.as_deref(), Some("2026-09-16"));
    assert_eq!(time_paths(&c, n.id), vec!["时间排序/2026/09/16".to_string()]);
    assert_eq!(moved.tags, vec!["工作".to_string(), "时间排序/2026/09/16".to_string()]);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='时间排序/2026/09/15'", &[]), 0,
        "旧日节点解链后按既有策略回收");
    assert_eq!(link_count(&c, n.id), 2, "时间标签 + 普通标签");
}

#[test]
fn set_date_collapses_multiple_time_tags_to_one() {
    let mut c = db();
    let n = create_on(&mut c, "手打多条", "2026-09-15").unwrap();
    // 模拟正文手打的时间标签与系统标签并存(link_paths 是替换语义,故三条一起给)
    crate::db::repos::tags_tree::link_paths(
        &c,
        n.id,
        &[
            "时间排序/2020/05/06".to_string(),
            "时间排序/2021/01/02".to_string(),
            "时间排序/2026/09/15".to_string(),
        ],
    )
    .unwrap();
    assert_eq!(time_paths(&c, n.id).len(), 3);

    let moved = set_date(&mut c, n.id, "2026-10-01").unwrap().unwrap();

    assert_eq!(time_paths(&c, n.id), vec!["时间排序/2026/10/01".to_string()], "收敛为一个");
    assert_eq!(moved.date.as_deref(), Some("2026-10-01"));
    assert_eq!(
        count(
            &c,
            "SELECT COUNT(*) FROM tags WHERE path IN ('时间排序/2020/05/06','时间排序/2021/01/02')",
            &[]
        ),
        0,
        "手打的旧时间节点同样被回收"
    );
}

#[test]
fn set_date_rejects_invalid_date() {
    let mut c = db();
    let n = create_on(&mut c, "非法日期不生效", "2026-09-15").unwrap();

    for bad in ["2026-13-45", "2026-02-30", "2026/09/16", "20260916", ""] {
        let err = set_date(&mut c, n.id, bad).unwrap_err();
        assert!(err.to_string().contains("日期格式不正确"), "{bad} -> {err}");
    }

    let after = read_full(&c, n.id).unwrap().unwrap();
    assert_eq!(after.date.as_deref(), Some("2026-09-15"), "拒绝后原时间标签不变");
    assert_eq!(time_paths(&c, n.id), vec!["时间排序/2026/09/15".to_string()]);
}

#[test]
fn set_date_same_day_stays_single_link() {
    let mut c = db();
    let n = create_on(&mut c, "同日幂等", "2026-09-15").unwrap();

    for _ in 0..2 {
        let same = set_date(&mut c, n.id, "2026-09-15").unwrap().unwrap();
        assert_eq!(same.date.as_deref(), Some("2026-09-15"));
    }

    assert_eq!(time_paths(&c, n.id), vec!["时间排序/2026/09/15".to_string()]);
    assert_eq!(link_count(&c, n.id), 1, "不产生重复链接");
}

#[test]
fn set_date_keeps_normal_tags() {
    let mut c = db();
    let n = create_on(&mut c, "买牛奶 #todo", "2026-09-15").unwrap();

    let moved = set_date(&mut c, n.id, "2025-01-02").unwrap().unwrap();

    assert_eq!(moved.tags, vec!["todo".to_string(), "时间排序/2025/01/02".to_string()]);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='todo'", &[]), 1);
}

#[test]
fn set_date_missing_note_returns_none() {
    let mut c = db();
    assert!(set_date(&mut c, 999, "2026-01-02").unwrap().is_none());
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM tags WHERE path='时间排序/2026/01/02'", &[]),
        0,
        "无该笔记时不建树"
    );
}
