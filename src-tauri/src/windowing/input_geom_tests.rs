//! 几何语义迁移的事务性测试(内存库):换算正确性、幂等不二次相除、失败整体回滚
use super::*;
use crate::db::migrate;
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn set(c: &Connection, key: &str, value: &str) {
    crate::db::repos::settings::set(c, key, value).unwrap();
}

fn get(c: &Connection, key: &str) -> Option<String> {
    crate::db::repos::settings::get(c, key).unwrap()
}

/// 旧库快照:含缩放的尺寸 + 系数,无标记
fn legacy() -> Connection {
    let c = db();
    set(&c, "input_w", "525");
    set(&c, "input_h", "111");
    set(&c, "input_zoom", "1.30");
    c
}

#[test]
fn migrate_converts_legacy_geometry_and_writes_mark() {
    let mut c = legacy();
    assert_eq!(migrate_conn(&mut c).unwrap(), Some((404, 85)));
    assert_eq!(get(&c, "input_w").as_deref(), Some("404"));
    assert_eq!(get(&c, "input_h").as_deref(), Some("85"));
    assert_eq!(get(&c, "input_zoom").as_deref(), Some("1.30")); // 系数不动
    assert_eq!(get(&c, GEOM_VERSION_KEY).as_deref(), Some("1"));
}

#[test]
fn migrate_is_idempotent_and_never_divides_twice() {
    let mut c = legacy();
    assert_eq!(migrate_conn(&mut c).unwrap(), Some((404, 85)));
    // 第二次:标记已存在,直接返回且不落任何写入
    assert_eq!(migrate_conn(&mut c).unwrap(), None);
    assert_eq!(get(&c, "input_w").as_deref(), Some("404"));
    assert_eq!(get(&c, "input_h").as_deref(), Some("85"));
    // 手工构造「已跑过新语义构建但标记缺失」的库:再跑一次确实会二次相除(见报告修复轮 2 C 节)
    assert_eq!(migrate_size(404.0, 85.0, 1.30), (311, 65));
}

#[test]
fn migrate_rolls_back_when_mark_write_fails() {
    let mut c = legacy();
    // 让标记键的写入必然失败:两键与标记同事务,任一失败即整体回滚
    c.execute_batch(
        "CREATE TRIGGER boom BEFORE INSERT ON settings
         WHEN NEW.key = 'input_geom_ver' BEGIN SELECT RAISE(ABORT, 'boom'); END;",
    )
    .unwrap();
    assert!(migrate_conn(&mut c).is_err());
    // 关键断言:input_w/input_h 不能被单独改写(否则下次启动会再除一次)
    assert_eq!(get(&c, "input_w").as_deref(), Some("525"));
    assert_eq!(get(&c, "input_h").as_deref(), Some("111"));
    assert_eq!(get(&c, GEOM_VERSION_KEY), None);
}

#[test]
fn migrate_without_geometry_keys_only_marks() {
    let mut c = db();
    set(&c, "input_zoom", "1.30");
    assert_eq!(migrate_conn(&mut c).unwrap(), None);
    assert_eq!(get(&c, GEOM_VERSION_KEY).as_deref(), Some("1"));
    assert_eq!(get(&c, "input_w"), None);
}

#[test]
fn migrate_after_rollback_succeeds_on_retry() {
    let mut c = legacy();
    c.execute_batch(
        "CREATE TRIGGER boom BEFORE INSERT ON settings
         WHEN NEW.key = 'input_geom_ver' BEGIN SELECT RAISE(ABORT, 'boom'); END;",
    )
    .unwrap();
    assert!(migrate_conn(&mut c).is_err());
    c.execute_batch("DROP TRIGGER boom").unwrap();
    // 回滚后重试:按**未换算的**旧值算一次,不会叠加
    assert_eq!(migrate_conn(&mut c).unwrap(), Some((404, 85)));
    assert_eq!(get(&c, "input_w").as_deref(), Some("404"));
}
