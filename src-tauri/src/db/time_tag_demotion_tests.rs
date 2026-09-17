//! 迁移 011(spec 2026-09-17 D2/D3/D5):时间标签降级为普通标签。
//! ① FTS 标签聚合重新纳入时间标签(取消 009 的"排除时间子树"例外),回填后行数 = 笔记数
//! ② saved_views.conditions 里的 from/to 被清掉(幂等;不含这两个键的行原样不动)
//! ③ 设置键 auto_time_tag / time_tag_template 登记(用户已改过的值不被覆盖)
//! ④ 幂等:重放 011 的 SQL 与再次 run 都不改库
//! ⑤ 触发器与 tags_tree::refresh_fts 口径一致
use super::{latest_version, run, MIGRATIONS};
use crate::db::repos::notes::notes_filter::*;
use crate::db::repos::notes::query;
use rusqlite::Connection;

/// 011 在迁移序列中的位次(1 起);旧库 = 应用到 011 之前(user_version 停在 10)
const V_011: usize = 11;

/// 模拟升级前旧库:到 010 为止(时间标签已被 009 清洗出 tags 列)
fn db_at_010() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    for (i, sql) in MIGRATIONS.iter().enumerate().take(V_011 - 1) {
        conn.execute_batch(sql).unwrap();
        conn.pragma_update(None, "user_version", (i + 1) as i64).unwrap();
    }
    conn
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn fts_tags(conn: &Connection, id: i64) -> String {
    conn.query_row("SELECT tags FROM notes_fts WHERE rowid=?1", [id], |r| r.get(0))
        .unwrap()
}

fn hits(conn: &Connection, keyword: &str) -> usize {
    query(conn, &FilterConditions { keyword: Some(keyword.into()), ..empty() }, 0)
        .unwrap()
        .len()
}

/// 旧库数据:一条带 `时间排序/2026/03/04` 时间标签的历史笔记 + 一个普通标签
fn seed_old_db(conn: &Connection) -> i64 {
    conn.execute_batch(
        "INSERT INTO notes(content, created_at, updated_at)
           VALUES('历史笔记', '2026-03-04 10:00:00', '2026-03-04 10:00:00');
         INSERT INTO tags(name, parent_id, path, depth) VALUES('甲', NULL, '甲', 1);
         INSERT INTO tags(name, parent_id, path, depth) VALUES('时间排序', NULL, '时间排序', 1);
         INSERT INTO tags(name, parent_id, path, depth)
           VALUES('2026', (SELECT id FROM tags WHERE path='时间排序'), '时间排序/2026', 2);
         INSERT INTO tags(name, parent_id, path, depth)
           VALUES('03', (SELECT id FROM tags WHERE path='时间排序/2026'), '时间排序/2026/03', 3);
         INSERT INTO tags(name, parent_id, path, depth)
           VALUES('04', (SELECT id FROM tags WHERE path='时间排序/2026/03'), '时间排序/2026/03/04', 4);
         INSERT INTO tag_links(tag_id, target_type, target_id)
           VALUES((SELECT id FROM tags WHERE path='甲'), 'note', 1);
         INSERT INTO tag_links(tag_id, target_type, target_id)
           VALUES((SELECT id FROM tags WHERE path='时间排序/2026/03/04'), 'note', 1);",
    )
    .unwrap();
    1
}

/// 011 之前:时间标签被排除在 tags 列外(009 的口径,此处先立前提再验证迁移结果)
#[test]
fn migration_011_puts_time_tags_back_into_fts() {
    let conn = db_at_010();
    let id = seed_old_db(&conn);
    assert_eq!(fts_tags(&conn, id), "甲", "011 之前:时间标签不进索引(009 口径)");
    assert_eq!(hits(&conn, "2026"), 0, "011 之前:搜年份不命中时间标签");

    run(&conn).unwrap();

    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(version, latest_version());
    let tags = fts_tags(&conn, id);
    assert!(tags.contains("甲"), "普通标签仍在索引里:{tags}");
    assert!(tags.contains("时间排序/2026/03/04"), "时间标签必须进索引(D3):{tags}");
    // 明示代价:搜年份/月份会命中该时段的全部笔记(一致性换来的)
    assert_eq!(hits(&conn, "2026"), 1);
    assert_eq!(hits(&conn, "03"), 1, "短关键词 LIKE 分支同样一视同仁");
    assert_eq!(hits(&conn, "历史笔记"), 1, "正文关键词不受影响");
    // 回填后 FTS 行数 = 笔记数(不多不少,没有悬空索引)
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM notes_fts"), count(&conn, "SELECT COUNT(*) FROM notes"));
}

/// ② saved_views 条件清理:含 from/to 的行被清掉且其余键保留;不含的行按字节不动
#[test]
fn migration_011_cleans_saved_views_dates_only() {
    let conn = db_at_010();
    conn.execute_batch(
        "INSERT INTO saved_views(title, conditions, sort_order)
           VALUES('带日期', '{\"keyword\":\"甲\",\"tags\":[],\"excludeTags\":[],\"from\":\"2026-08-01\",\"to\":\"2026-08-31\",\"tagPresence\":null,\"sort\":\"newest\",\"expr\":null}', 0);
         INSERT INTO saved_views(title, conditions, sort_order)
           VALUES('不带日期', '{\"keyword\":null,\"tags\":[{\"path\":\"甲\",\"includeChildren\":false}],\"excludeTags\":[],\"tagPresence\":null,\"sort\":\"oldest\",\"expr\":\"#甲\"}', 1);
         INSERT INTO saved_views(title, conditions, sort_order)
           VALUES('坏行', '{bad json', 2);",
    )
    .unwrap();
    let before: String = conn
        .query_row("SELECT conditions FROM saved_views WHERE title='不带日期'", [], |r| r.get(0))
        .unwrap();

    run(&conn).unwrap();

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
    let broken: String = conn
        .query_row("SELECT conditions FROM saved_views WHERE title='坏行'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(broken, "{bad json", "坏 JSON 行不得被改写");
    let plain: String = conn
        .query_row("SELECT conditions FROM saved_views WHERE title='不带日期'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(plain, before, "不含 from/to 的行不得被改写");
}

/// ③ 设置键登记:缺失则写默认;已存在(用户改过)则保留
#[test]
fn migration_011_registers_settings_keys() {
    let conn = db_at_010();
    crate::db::repos::settings::set(&conn, "auto_time_tag", "false").unwrap();
    crate::db::repos::settings::set(&conn, "time_tag_template", "日期/{y}/{m}/{d}").unwrap();

    run(&conn).unwrap();

    let get = |k: &str| crate::db::repos::settings::get(&conn, k).unwrap();
    assert_eq!(get("auto_time_tag").as_deref(), Some("false"), "用户值不得被覆盖");
    assert_eq!(get("time_tag_template").as_deref(), Some("日期/{y}/{m}/{d}"));

    // 全新库:默认值与 timetag::DEFAULT_TEMPLATE 一致,开关为 true
    let fresh = Connection::open_in_memory().unwrap();
    run(&fresh).unwrap();
    let get = |k: &str| crate::db::repos::settings::get(&fresh, k).unwrap();
    assert_eq!(get("auto_time_tag").as_deref(), Some("true"));
    assert_eq!(get("time_tag_template").as_deref(), Some(crate::timetag::DEFAULT_TEMPLATE));
}

/// ④ 幂等:重放 011 的 SQL 与再次 run 都不改库(FTS 索引串/视图条件/设置全等)
#[test]
fn migration_011_is_idempotent() {
    let conn = db_at_010();
    let id = seed_old_db(&conn);
    conn.execute_batch(
        "INSERT INTO saved_views(title, conditions, sort_order)
           VALUES('带日期', '{\"keyword\":null,\"tags\":[],\"excludeTags\":[],\"from\":\"2026-08-01\",\"to\":null,\"tagPresence\":null,\"sort\":null,\"expr\":null}', 0);",
    )
    .unwrap();
    run(&conn).unwrap();
    let snapshot = || {
        format!(
            "{}|{}|{}|{}|{}",
            fts_tags(&conn, id),
            count(&conn, "SELECT COUNT(*) FROM notes_fts"),
            conn.query_row("SELECT conditions FROM saved_views WHERE title='带日期'", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            crate::db::repos::settings::get(&conn, "auto_time_tag").unwrap().unwrap(),
            crate::db::repos::settings::get(&conn, "time_tag_template").unwrap().unwrap(),
        )
    };
    let once = snapshot();

    // 直接重放 011 的 SQL(版本闸门之外的兜底幂等),再跑一次迁移序列
    conn.execute_batch(MIGRATIONS[V_011 - 1]).unwrap();
    assert_eq!(snapshot(), once, "重放 011 必须不改库");
    run(&conn).unwrap();
    assert_eq!(snapshot(), once);

    // 再跑一遍 002 之前的 008 回填也不该给已有时间标签的笔记再建一棵树
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM tags WHERE path='时间排序/2026'"), 1);
}

/// ⑤ 迁移后的触发器与结构变更路径(refresh_fts)口径必须完全一致
#[test]
fn migration_011_triggers_agree_with_refresh_fts() {
    let mut conn = db_at_010();
    run(&conn).unwrap();
    let id = crate::db::repos::notes::create(&mut conn, "新笔记 #乙").unwrap().id;
    let created = fts_tags(&conn, id);
    assert!(created.contains('乙') && created.contains("时间排序"), "{created}");
    // 正文更新触发器(notes_au)
    conn.execute("UPDATE notes SET content='改过的正文' WHERE id=?1", [id]).unwrap();
    let updated = fts_tags(&conn, id);
    assert!(updated.contains('乙') && updated.contains("时间排序"), "{updated}");
    // 结构变更路径(tags_tree::refresh_fts)口径必须一致
    conn.execute("DELETE FROM notes_fts WHERE rowid=?1", [id]).unwrap();
    crate::db::repos::tags_tree::refresh_fts(&conn, &[id]).unwrap();
    assert_eq!(fts_tags(&conn, id), updated, "两条写入路径的索引串必须一致");
}
