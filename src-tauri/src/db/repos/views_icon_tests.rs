//! 视图图标测试(迁移 010 + icon 字段读写 + 图标名校验):
//! 幂等迁移把 icon 列加到既有库上(旧行为 NULL),CRUD 往返带 icon,坏名字被拒。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes::FilterConditions;
use crate::db::repos::notes::notes_filter::empty;
use rusqlite::Connection;

/// 迁移到最新的内存库
fn test_conn() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

/// `PRAGMA table_info(saved_views)` 里某列是否存在 + notnull 标志
fn column(c: &Connection, name: &str) -> Option<i64> {
    let mut stmt = c.prepare("PRAGMA table_info(saved_views)").unwrap();
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(1)?, r.get::<_, i64>(3)?)))
        .unwrap()
        .collect::<rusqlite::Result<Vec<(String, i64)>>>()
        .unwrap();
    rows.into_iter().find(|(n, _)| n == name).map(|(_, notnull)| notnull)
}

/// 010 幂等:同一库连跑两次不报错;icon 列存在且可空;升级前已存在的行 icon 为 NULL
#[test]
fn migration_010_is_idempotent_and_adds_nullable_icon() {
    let c = Connection::open_in_memory().unwrap();
    // 模拟迁移前的真实库:先造 007 的 saved_views 表与一行旧数据(user_version 仍为 0)
    c.execute_batch(include_str!("../migrations/007_saved_views.sql")).unwrap();
    let json = serde_json::to_string(&FilterConditions::default()).unwrap();
    c.execute(
        "INSERT INTO saved_views(title, conditions, sort_order) VALUES('旧视图', ?1, 0)",
        rusqlite::params![json],
    )
    .unwrap();

    migrate::run(&c).unwrap();
    migrate::run(&c).unwrap(); // 幂等:第二次是空操作,不报错

    let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(version, migrate::latest_version(), "迁移必须跑到最新版本");
    assert!(version >= 10, "010 起 icon 列必须存在(当前版本 {version})");
    assert_eq!(column(&c, "icon"), Some(0), "icon 列必须存在且可空(notnull=0)");
    let all = list(&c).unwrap();
    assert_eq!(all.len(), 1, "迁移不得丢既有视图");
    assert_eq!(all[0].icon, None, "升级前已存在的视图 icon 为 NULL");
}

/// create / update 往返带 icon:写入后 list 读回;update(None) 清空图标;创建默认无图标
#[test]
fn create_and_update_view_roundtrip_icon() {
    let conn = test_conn();
    let id = create(&conn, "带图标", &empty(), Some("star")).unwrap();
    let all = list(&conn).unwrap();
    assert_eq!(all[0].icon.as_deref(), Some("star"));

    update(&conn, id, "带图标", &empty(), None).unwrap();
    assert_eq!(list(&conn).unwrap()[0].icon, None, "update(None) 清空图标");

    update(&conn, id, "带图标", &empty(), Some("calendar-days")).unwrap();
    assert_eq!(list(&conn).unwrap()[0].icon.as_deref(), Some("calendar-days"));

    let plain = create(&conn, "无图标", &empty(), None).unwrap();
    assert_eq!(
        list(&conn).unwrap().into_iter().find(|v| v.id == plain).unwrap().icon,
        None
    );
}

/// 空串 / 全空白等价于无图标(入库为 NULL,不写空串)
#[test]
fn blank_icon_is_stored_as_null() {
    let conn = test_conn();
    let a = create(&conn, "空串", &empty(), Some("")).unwrap();
    let b = create(&conn, "空白", &empty(), Some("   ")).unwrap();
    let all = list(&conn).unwrap();
    assert_eq!(all.iter().find(|v| v.id == a).unwrap().icon, None);
    assert_eq!(all.iter().find(|v| v.id == b).unwrap().icon, None);
}

/// 坏图标名在写库前被拒:不落库、不改动原数据
#[test]
fn invalid_icon_rejected_on_write() {
    let conn = test_conn();
    assert!(create(&conn, "坏图标", &empty(), Some("Star")).is_err());
    assert!(create(&conn, "坏图标", &empty(), Some(&"a".repeat(41))).is_err());
    assert!(list(&conn).unwrap().is_empty(), "被拒的视图不得落库");

    let id = create(&conn, "好图标", &empty(), Some("star")).unwrap();
    assert!(update(&conn, id, "好图标", &empty(), Some("星")).is_err());
    assert_eq!(list(&conn).unwrap()[0].icon.as_deref(), Some("star"), "失败的更新不动原值");
}

/// 校验函数的格式与长度口径(空串合法 = 无图标)
#[test]
fn validate_icon_rejects_bad_names() {
    assert!(validate_icon(None).is_ok());
    assert!(validate_icon(Some("star")).is_ok());
    assert!(validate_icon(Some("list-checks")).is_ok());
    assert!(validate_icon(Some("gamepad-2")).is_ok());
    assert!(validate_icon(Some("")).is_ok(), "空串等价于无图标");
    assert!(validate_icon(Some(&"a".repeat(40))).is_ok(), "40 是允许的最长");
    assert!(validate_icon(Some("Star")).is_err(), "大写不允许");
    assert!(validate_icon(Some("星")).is_err(), "非 ASCII 不允许");
    assert!(validate_icon(Some("star_x")).is_err(), "下划线不在白名单字符集");
    assert!(validate_icon(Some("star x")).is_err(), "空格不允许");
    assert!(validate_icon(Some(&"a".repeat(41))).is_err(), "超长");
    assert_eq!(validate_icon(Some(&"a".repeat(41))).unwrap_err(), "图标名过长");
    assert_eq!(validate_icon(Some("Star")).unwrap_err(), "图标名不合法");
}
