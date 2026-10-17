//! 批量加 / 去标签的仓库层用例(spec 2026-10-17 §4.1 / §4.2)。
//! 覆盖:幂等、目标不存在拒绝、自指 / 脏 id 跳过、名线不动、单事务回滚。
use super::{add_tag, remove_tag};
use crate::db::migrate;
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrate::run(&c).unwrap();
    c
}

/// 三条笔记(1/2/3)+ 两个标签(10 目标 / 11 别的)+ 一个名字点(20)。
fn seed(c: &Connection) {
    c.execute_batch(
        "INSERT INTO points(id, meta, created_at, path, depth) VALUES
           (1, '笔记甲', '2026-01-01', NULL, NULL),
           (2, '笔记乙', '2026-01-01', NULL, NULL),
           (3, '笔记丙', '2026-01-01', NULL, NULL),
           (10, '目标', '2026-01-01', '目标', 1),
           (11, '别的', '2026-01-01', '别的', 1),
           (20, '状态', '2026-01-01', NULL, NULL);",
    )
    .unwrap();
}

fn count_lines(c: &Connection, to: i64) -> i64 {
    c.query_row("SELECT COUNT(*) FROM lines WHERE to_id = ?1", params![to], |r| r.get(0)).unwrap()
}

fn count_named(c: &Connection, to: i64) -> i64 {
    c.query_row(
        "SELECT COUNT(*) FROM lines WHERE to_id = ?1 AND name_id IS NOT NULL",
        params![to],
        |r| r.get(0),
    )
    .unwrap()
}

/// 重复加同一条目:第二次全部计入 existed,库里线数不变(幂等)。
#[test]
fn add_is_idempotent_and_counts_existed() {
    let mut c = db();
    seed(&c);
    let first = add_tag(&mut c, &[1, 2], 10).unwrap();
    assert_eq!((first.added, first.existed), (2, 0));
    let second = add_tag(&mut c, &[1, 2], 10).unwrap();
    assert_eq!((second.added, second.existed), (0, 2));
    assert_eq!(count_lines(&c, 10), 2);
}

/// 目标必须是存在的树内标签:不存在的 id 与笔记 id(树外点)都被拒,库里零变化。
#[test]
fn add_rejects_missing_target() {
    let mut c = db();
    seed(&c);
    let err = add_tag(&mut c, &[1], 999).unwrap_err();
    assert!(err.contains("标签不存在"), "错误信息应给中文原因: {err}");
    let note_as_target = add_tag(&mut c, &[1], 2).unwrap_err();
    assert!(note_as_target.contains("标签不存在"), "笔记 id 不能当标签目标: {note_as_target}");
    assert_eq!(count_lines(&c, 10), 0);
}

/// 自指(目标本身在选中里)与脏 id 都跳过且计入 existed,不写脏线。
#[test]
fn add_skips_self_and_dirty_ids() {
    let mut c = db();
    seed(&c);
    let r = add_tag(&mut c, &[1, 10, 999], 10).unwrap();
    assert_eq!((r.added, r.existed), (1, 2));
    assert_eq!(count_lines(&c, 10), 1);
}

/// 已有名线(关系)不阻止再加一条无名字线:标签与关系是两种线,并存。
#[test]
fn add_coexists_with_existing_named_line() {
    let mut c = db();
    seed(&c);
    c.execute("INSERT INTO lines(id, from_id, to_id, name_id) VALUES (100, 1, 10, 20)", [])
        .unwrap();
    let r = add_tag(&mut c, &[1], 10).unwrap();
    assert_eq!((r.added, r.existed), (1, 0));
    assert_eq!(count_lines(&c, 10), 2);
    assert_eq!(count_named(&c, 10), 1);
}

/// 去标签只删无名字线:名线原样保留,并计入 kept_named。
#[test]
fn untag_removes_only_unnamed_lines() {
    let mut c = db();
    seed(&c);
    c.execute_batch(
        "INSERT INTO lines(id, from_id, to_id, name_id) VALUES
           (100, 1, 10, NULL),
           (101, 1, 10, 20),
           (102, 1, 11, NULL);",
    )
    .unwrap();
    let r = remove_tag(&mut c, &[1], 10).unwrap();
    assert_eq!((r.removed, r.kept_named), (1, 1));
    assert_eq!(count_lines(&c, 11), 1, "别的目标的线不该被碰");
}

/// 名线不动的独立钉子(变异自证 ①):只留名线时 removed=0,线还在。
#[test]
fn untag_keeps_named_lines() {
    let mut c = db();
    seed(&c);
    c.execute("INSERT INTO lines(id, from_id, to_id, name_id) VALUES (101, 1, 10, 20)", [])
        .unwrap();
    let r = remove_tag(&mut c, &[1], 10).unwrap();
    assert_eq!((r.removed, r.kept_named), (0, 1));
    let still: bool = c
        .query_row("SELECT EXISTS(SELECT 1 FROM lines WHERE id = 101 AND name_id = 20)", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert!(still, "名线必须原样保留");
}

/// 目标不存在的去标签按幂等处理:0/0,不报错。
#[test]
fn untag_missing_target_is_noop() {
    let mut c = db();
    seed(&c);
    let r = remove_tag(&mut c, &[1], 999).unwrap();
    assert_eq!((r.removed, r.kept_named), (0, 0));
}

/// 单事务回滚(变异自证 ②):中途插入失败时,先前插的线一条不落。
#[test]
fn rollback_leaves_nothing() {
    let mut c = db();
    seed(&c);
    c.execute_batch(
        "CREATE TRIGGER boom BEFORE INSERT ON lines
         WHEN NEW.from_id = 3 BEGIN SELECT RAISE(ABORT, 'boom'); END;",
    )
    .unwrap();
    let err = add_tag(&mut c, &[1, 2, 3], 10).unwrap_err();
    assert!(err.contains("boom"), "应冒出底层失败: {err}");
    assert_eq!(count_lines(&c, 10), 0, "回滚后一条线都不该留");
}
