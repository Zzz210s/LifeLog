//! 时间子树结构守卫(spec 2026-09-15 第 4.5 节后端半边):
//! `时间排序` 及其后代不可改名 / 移动 / 删除;普通标签不受影响,移动目标也不可是时间节点。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes;
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", [path], |r| r.get(0))
        .unwrap()
}

/// 标签表全量快照(按 id 排序):守卫拒绝时不得有任何写库痕迹
fn dump(c: &Connection) -> Vec<String> {
    let mut stmt = c
        .prepare("SELECT id, name, COALESCE(parent_id, 0), path, depth FROM tags ORDER BY id")
        .unwrap();
    let rows = stmt
        .query_map([], |r| {
            Ok(format!(
                "{}|{}|{}|{}|{}",
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?
            ))
        })
        .unwrap();
    rows.collect::<rusqlite::Result<Vec<_>>>().unwrap()
}

/// 造一棵时间子树并挂一条笔记:时间排序/2026/09/15(depth 1..4)
fn with_time_tree() -> (Connection, i64) {
    let mut c = db();
    notes::create_on(&mut c, "当天笔记 #工作", "2026-09-15").unwrap();
    let day = id_at(&c, "时间排序/2026/09/15");
    (c, day)
}

#[test]
fn time_subtree_cannot_be_renamed() {
    let (mut c, day) = with_time_tree();
    let root = id_at(&c, "时间排序");
    let year = id_at(&c, "时间排序/2026");
    let work = id_at(&c, "工作");
    let before = dump(&c);

    assert_eq!(rename(&mut c, root, "改成别的").unwrap_err(), "时间标签由系统维护,不能改名");
    assert_eq!(rename(&mut c, year, "2027").unwrap_err(), "时间标签由系统维护,不能改名");
    assert_eq!(rename(&mut c, day, "16").unwrap_err(), "时间标签由系统维护,不能改名");
    assert_eq!(dump(&c), before, "被拒的改名不得留下任何写库痕迹");

    // 普通标签照常可改名
    rename(&mut c, work, "工作台").unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='工作台'"), 1);
}

#[test]
fn time_subtree_cannot_be_moved() {
    let (mut c, day) = with_time_tree();
    let root = id_at(&c, "时间排序");
    let year = id_at(&c, "时间排序/2026");
    let work = id_at(&c, "工作");
    let before = dump(&c);

    assert_eq!(move_to(&mut c, root, None).unwrap_err(), "不能移动时间标签");
    assert_eq!(move_to(&mut c, year, Some(work)).unwrap_err(), "不能移动时间标签");
    assert_eq!(move_to(&mut c, day, None).unwrap_err(), "不能移动时间标签");
    assert_eq!(dump(&c), before, "被拒的移动不得留下任何写库痕迹");

    // 目标守卫:普通标签也不可移进时间子树(会把日期结构搅乱)
    assert_eq!(move_to(&mut c, work, Some(root)).unwrap_err(), "不能移动到时间标签下");
    assert_eq!(move_to(&mut c, work, Some(day)).unwrap_err(), "不能移动到时间标签下");
    assert_eq!(dump(&c), before);

    // 普通结构内移动照常可做(带链接的节点移动后仍保留)
    notes::create_plain(&mut c, "第二条 #工作/项目A").unwrap();
    let leaf = id_at(&c, "工作/项目A");
    move_to(&mut c, leaf, None).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='项目A' AND parent_id IS NULL"), 1);
}

#[test]
fn time_subtree_cannot_be_deleted() {
    let (mut c, day) = with_time_tree();
    let root = id_at(&c, "时间排序");
    let month = id_at(&c, "时间排序/2026/09");
    let work = id_at(&c, "工作");
    let before = dump(&c);

    assert_eq!(delete_subtree(&mut c, root).unwrap_err(), "不能删除时间标签");
    assert_eq!(delete_subtree(&mut c, month).unwrap_err(), "不能删除时间标签");
    assert_eq!(delete_subtree(&mut c, day).unwrap_err(), "不能删除时间标签");
    assert_eq!(dump(&c), before, "被拒的删除不得留下任何写库痕迹");
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM tag_links WHERE target_type='note'"),
        2,
        "时间链与工作链都还在"
    );

    // 普通标签照常可删,时间子树不受影响
    delete_subtree(&mut c, work).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='工作'"), 0);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='时间排序/2026/09/15'"), 1);
}

/// 时间根用真实 DB id 寻址(不是界面补出的结构节点);空库里没有时间根时守卫放行
#[test]
fn time_root_id_is_real_and_guard_passes_on_empty_db() {
    let (c, day) = with_time_tree();
    let root = time_root_id(&c).unwrap();
    assert_eq!(root, Some(id_at(&c, "时间排序")));
    assert_ne!(root, Some(day));

    let mut empty = db();
    assert_eq!(time_root_id(&empty).unwrap(), None);
    let normal = ensure_path(&empty, &["普通".into()]).unwrap();
    rename(&mut empty, normal, "普通改").unwrap();
    let renamed = id_at(&empty, "普通改");
    delete_subtree(&mut empty, renamed).unwrap();
}
