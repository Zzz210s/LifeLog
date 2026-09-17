//! 014 删除视图模块(S6)与 011 对 saved_views 的历史断言(自 time_tag_demotion_tests 拆出):
//! 014 之后 saved_views 表在最新库里已不存在,涉及该表的断言必须停在 011 的版本上 ——
//! 拆出来既守住单文件 200 行,也让"表被删"与"表曾被 011 清洗"两组读数各自独立。
use super::{apply, latest_version, run, MIGRATIONS};
use crate::db::repos::notes::FilterConditions;
use crate::db::repos::settings;
use rusqlite::Connection;

/// 把迁移序列应用到 version 为止(SQL 与 user_version 同步推进;已应用的版本跳过,
/// 因此可重复调用进版本号 —— 例如先停在 011 断言,再跑到最新)
fn run_up_to(conn: &Connection, version: usize) {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    for (i, sql) in MIGRATIONS.iter().enumerate().take(version) {
        let v = (i + 1) as i64;
        if v <= current {
            continue;
        }
        apply(conn, sql, v).unwrap();
    }
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn text(conn: &Connection, sql: &str) -> String {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// ① 全新库跑到最新:saved_views 表与索引都不存在(filter_last 的清理见下一个用例)
#[test]
fn migration_014_drops_saved_views_table_on_fresh_db() {
    let conn = Connection::open_in_memory().unwrap();
    run(&conn).unwrap();

    assert_eq!(count(&conn, "PRAGMA user_version"), latest_version());
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM sqlite_master WHERE name='saved_views'"),
        0,
        "saved_views 表必须不存在"
    );
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM sqlite_master WHERE name='idx_saved_views_sort'"),
        0,
        "排序索引随表消失"
    );
}

/// ② 升级路径(v13 旧库):存量视图随表删除,标签页状态与既有笔记/标签数据原样保留
#[test]
fn migration_014_removes_views_and_keeps_tabs_state() {
    let conn = Connection::open_in_memory().unwrap();
    run_up_to(&conn, 13);
    let tabs = "{\"tabs\":[{\"title\":\"\",\"conditions\":{\"keyword\":null,\"tags\":[],\
                \"excludeTags\":[],\"tagPresence\":null,\"sort\":\"newest\",\"expr\":null}}],\
                \"activeIndex\":0}";
    conn.execute_batch(
        "INSERT INTO saved_views(title, conditions, sort_order) VALUES('旧视图', '{}', 0);
         INSERT INTO saved_views(title, conditions, sort_order) VALUES('旧视图二', '{}', 1);
         INSERT INTO notes(content) VALUES('迁移前笔记');",
    )
    .unwrap();
    settings::set(&conn, "filter_last", "{\"keyword\":\"旧\"}").unwrap();
    settings::set(&conn, "tabs_state", tabs).unwrap();

    run(&conn).unwrap();

    assert_eq!(count(&conn, "PRAGMA user_version"), latest_version());
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM sqlite_master WHERE name='saved_views'"), 0);
    assert_eq!(settings::get(&conn, "filter_last").unwrap(), None);
    assert_eq!(settings::get(&conn, "tabs_state").unwrap().unwrap(), tabs);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM notes"), 1);
    assert_eq!(text(&conn, "SELECT content FROM notes WHERE id = 1"), "迁移前笔记");
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM tag_links"), 0);
}

/// ③ 幂等:版本闸门之外,直接重放 014 的 SQL 也是空操作(删不存在的表/键都不报错)
#[test]
fn migration_014_is_idempotent() {
    let conn = Connection::open_in_memory().unwrap();
    run(&conn).unwrap();
    settings::set(&conn, "tabs_state", "{\"tabs\":[],\"activeIndex\":0}").unwrap();
    let snapshot = || {
        (
            count(&conn, "PRAGMA user_version"),
            settings::get(&conn, "tabs_state").unwrap(),
            settings::get(&conn, "filter_last").unwrap(),
        )
    };
    let first = snapshot();

    run(&conn).unwrap(); // 版本闸门:第二次为 no-op
    assert_eq!(snapshot(), first);

    let sql = MIGRATIONS[13];
    conn.execute_batch(sql).unwrap();
    conn.execute_batch(sql).unwrap(); // 本体重放两次
    assert_eq!(snapshot(), first, "重放 014 不得改库");
}

/// ④ 011 对 saved_views 的历史断言(表在 014 才被删,故这里停在 v11):
/// 含 from/to 的行被清掉且其余键保留;坏 JSON 行与不含日期的行逐字不动
#[test]
fn migration_011_cleans_saved_views_dates_only() {
    let conn = Connection::open_in_memory().unwrap();
    run_up_to(&conn, 10);
    conn.execute_batch(
        "INSERT INTO saved_views(title, conditions, sort_order)
           VALUES('带日期', '{\"keyword\":\"甲\",\"tags\":[],\"excludeTags\":[],\"from\":\"2026-08-01\",\"to\":\"2026-08-31\",\"tagPresence\":null,\"sort\":\"newest\",\"expr\":null}', 0);
         INSERT INTO saved_views(title, conditions, sort_order)
           VALUES('不带日期', '{\"keyword\":null,\"tags\":[{\"path\":\"甲\",\"includeChildren\":false}],\"excludeTags\":[],\"tagPresence\":null,\"sort\":\"oldest\",\"expr\":\"#甲\"}', 1);
         INSERT INTO saved_views(title, conditions, sort_order)
           VALUES('坏行', '{bad json', 2);",
    )
    .unwrap();
    let before = text(&conn, "SELECT conditions FROM saved_views WHERE title='不带日期'");

    run_up_to(&conn, 11);

    let cleaned: String = conn
        .query_row("SELECT conditions FROM saved_views WHERE title='带日期'", [], |r| r.get(0))
        .unwrap();
    assert!(!cleaned.contains("\"from\""), "{cleaned}");
    assert!(!cleaned.contains("\"to\""), "{cleaned}");
    assert!(cleaned.contains("\"keyword\":\"甲\""), "其余键必须保留:{cleaned}");
    assert!(cleaned.contains("\"sort\":\"newest\""), "{cleaned}");
    // 条件对象清理后仍可被仓库层反序列化(清键后语义不变);坏 JSON 行原样不动
    let cleaned_view: FilterConditions = serde_json::from_str(&cleaned).unwrap();
    assert_eq!(cleaned_view.keyword.as_deref(), Some("甲"));
    assert_eq!(cleaned_view.sort.as_deref(), Some("newest"));
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM saved_views"), 3, "坏 JSON 行不得被删");
    assert_eq!(
        text(&conn, "SELECT conditions FROM saved_views WHERE title='坏行'"),
        "{bad json",
        "坏 JSON 行不得被改写"
    );
    assert_eq!(
        text(&conn, "SELECT conditions FROM saved_views WHERE title='不带日期'"),
        before,
        "不含 from/to 的行不得被改写"
    );
}

/// ⑤ 011 幂等:重放 011 的 SQL 不改库(视图条件 / FTS 索引串 / 设置全等)
#[test]
fn migration_011_saved_views_cleaning_is_idempotent() {
    let conn = Connection::open_in_memory().unwrap();
    run_up_to(&conn, 10);
    conn.execute_batch(
        "INSERT INTO notes(content) VALUES('历史笔记');
         INSERT INTO saved_views(title, conditions, sort_order)
           VALUES('带日期', '{\"keyword\":null,\"tags\":[],\"excludeTags\":[],\"from\":\"2026-08-01\",\"to\":null,\"tagPresence\":null,\"sort\":null,\"expr\":null}', 0);",
    )
    .unwrap();
    run_up_to(&conn, 11);
    let snapshot = || {
        (
            text(&conn, "SELECT conditions FROM saved_views WHERE title='带日期'"),
            count(&conn, "SELECT COUNT(*) FROM notes_fts"),
            settings::get(&conn, "auto_time_tag").unwrap(),
        )
    };
    let once = snapshot();

    conn.execute_batch(MIGRATIONS[10]).unwrap();
    assert_eq!(snapshot(), once, "重放 011 必须不改库");
    run_up_to(&conn, 11);
    assert_eq!(snapshot(), once);
}
