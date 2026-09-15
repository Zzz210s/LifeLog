//! 保存路径自动添加时间标签,以及编辑正文 / 切换 #todo 后仍保留(spec 2026-09-15 第 4.2 节)。
//! 时间标签是系统添加:日期取本地当天;用户手打的 `#时间排序/...` 走普通标签解析(不特殊拦截)。
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

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", [path], |r| r.get(0))
        .unwrap()
}

/// 该笔记的时间标签路径集合
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

#[test]
fn create_adds_today_time_tag_in_same_transaction() {
    let mut c = db();
    let today = crate::timetag::today_local(&c).unwrap();
    let path = format!("时间排序/{}", today.replace('-', "/"));

    let n = create(&mut c, "正文 #工作").unwrap();

    assert_eq!(n.content, "正文");
    assert_eq!(n.tags, vec!["工作".to_string(), path.clone()], "标签按路径升序,含时间标签");
    assert_eq!(n.date.as_deref(), Some(today.as_str()));
    assert_eq!(n.date_tag_id, Some(id_at(&c, &path)));
    // 树与链接都落库:末级为 depth 4,链在末级
    let depth: i64 = c
        .query_row("SELECT depth FROM tags WHERE path=?1", [&path], |r| r.get(0))
        .unwrap();
    assert_eq!(depth, 4);
    assert_eq!(
        count(
            &c,
            "SELECT COUNT(*) FROM tag_links WHERE tag_id=?1 AND target_type='note' AND target_id=?2",
            &[&id_at(&c, &path), &n.id],
        ),
        1
    );
}

#[test]
fn create_reuses_same_day_node_for_other_notes() {
    let mut c = db();
    let today = crate::timetag::today_local(&c).unwrap();
    let path = format!("时间排序/{}", today.replace('-', "/"));

    let a = create(&mut c, "一").unwrap();
    let b = create(&mut c, "二").unwrap();

    assert_eq!(a.date_tag_id, b.date_tag_id);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path=?1", &[&path]), 1);
    assert_eq!(time_paths(&c, a.id), vec![path.clone()]);
    assert_eq!(time_paths(&c, b.id), vec![path]);
    // 同一天只有 时间排序/年/月/日 四个节点(无其它标签)
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags", &[]), 4);
}

#[test]
fn create_on_uses_given_date_and_plain_has_none() {
    let mut c = db();
    let n = create_on(&mut c, "指定日期", "2025-03-04").unwrap();
    assert_eq!(n.date.as_deref(), Some("2025-03-04"));
    assert_eq!(n.tags, vec!["时间排序/2025/03/04"]);

    let plain = create_plain(&mut c, "历史笔记 #甲").unwrap();
    assert_eq!(plain.tags, vec!["甲"], "create_plain 不添加时间标签(008 之前的形态)");
    assert_eq!(plain.date, None);
    assert_eq!(plain.date_tag_id, None);
}

/// 用户手打的时间标签走普通解析:同样建树建链,系统当天标签并存(不特殊拦截、不报错)
#[test]
fn create_with_handwritten_time_tag_parses_normally() {
    let mut c = db();
    let today = crate::timetag::today_local(&c).unwrap();

    let n = create(&mut c, "手打时间标签 #时间排序/2026/01/02").unwrap();

    assert_eq!(n.content, "手打时间标签");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='时间排序/2026/01/02'", &[]), 1);
    let mut expected = vec!["时间排序/2026/01/02".to_string()];
    if today != "2026-01-02" {
        expected.push(format!("时间排序/{}", today.replace('-', "/")));
    }
    assert_eq!(time_paths(&c, n.id), expected);
    // 深于四级的路径也允许(上限 5)
    create(&mut c, "更深 #时间排序/2026/01/02/子级").unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='时间排序/2026/01/02/子级'", &[]), 1);
}

/// 关键交互:编辑正文替换标签集合时,时间标签(不在正文里)必须保留
#[test]
fn update_keeps_time_tag() {
    let mut c = db();
    let today = crate::timetag::today_local(&c).unwrap();
    let path = format!("时间排序/{}", today.replace('-', "/"));
    let n = create(&mut c, "旧文 #甲标签").unwrap();

    let upd = update(&mut c, n.id, "新文 #乙标签").unwrap().unwrap();

    assert_eq!(upd.content, "新文");
    assert_eq!(upd.tags, vec!["乙标签".to_string(), path.clone()], "时间标签必须保留");
    assert_eq!(upd.date.as_deref(), Some(today.as_str()));
    assert_eq!(upd.date_tag_id, Some(id_at(&c, &path)));
    assert_eq!(time_paths(&c, n.id), vec![path.clone()], "时间标签链接仍在");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path=?1", &[&path]), 1, "节点未被回收");
    // 正文里手写的时间标签仍按普通标签替换语义处理(写新日期即改期)
    let moved = update(&mut c, n.id, "改期文 #时间排序/2020/05/06").unwrap().unwrap();
    assert_eq!(moved.tags, vec!["时间排序/2020/05/06".to_string(), path], "手打路径替换,系统标签保留");
    assert_eq!(moved.date.as_deref(), Some("2020-05-06"));
}

/// 正文编辑清空全部标签时,系统时间标签同样保留(空正文标签集合 = 只剩时间标签)
#[test]
fn update_with_no_tags_keeps_time_tag_only() {
    let mut c = db();
    let today = crate::timetag::today_local(&c).unwrap();
    let path = format!("时间排序/{}", today.replace('-', "/"));
    let n = create(&mut c, "旧文 #甲").unwrap();

    let upd = update(&mut c, n.id, "无标签新文").unwrap().unwrap();

    assert_eq!(upd.tags, vec![path]);
    assert_eq!(upd.date.as_deref(), Some(today.as_str()));
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE name='甲'", &[]), 0, "旧标签仍按语义回收");
}

/// #todo 勾选切换也走替换语义:时间标签保留,todo<->done 照常切换
#[test]
fn toggle_todo_keeps_time_tag() {
    let mut c = db();
    let today = crate::timetag::today_local(&c).unwrap();
    let path = format!("时间排序/{}", today.replace('-', "/"));
    let n = create(&mut c, "买牛奶 #todo").unwrap();

    let t = toggle_todo(&mut c, n.id).unwrap().unwrap();

    assert_eq!(t.tags, vec!["done".to_string(), path.clone()], "含 todo 换 done,时间标签保留");
    assert_eq!(t.date.as_deref(), Some(today.as_str()));
    let back = toggle_todo(&mut c, n.id).unwrap().unwrap();
    assert_eq!(back.tags, vec!["todo".to_string(), path]);
}
