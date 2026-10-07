//! 迁移 011(spec 2026-09-17 D2/D3/D5):时间标签降级为普通标签。
//! ① FTS 标签聚合重新纳入时间标签(取消 009 的"排除时间子树"例外),回填后行数 = 笔记数
//! ② saved_views.conditions 里的 from/to 被清掉(表已在 014 被删,历史断言见
//!    saved_views_removal_tests.rs,本文件只保留与表无关的读数)
//! ③ 设置键 auto_time_tag / time_tag_template 登记(用户已改过的值不被覆盖)
//! ④ 幂等:重放 011 的 SQL 不改库
//! ⑤ 终态(`entities_fts`)的触发器与显式重写口径一致
//!
//! 阶段 4(027)后终态只读 `entities_fts`;本文件对 011 本体停在 v11 读老 `notes_fts`,
//! 对终态另用 `entities_fts` 的读数。
use super::{apply, latest_version, run, MIGRATIONS};
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

/// 只应用 011 本体并推进版本号(011 的 SQL 里有 saved_views UPDATE,重放前必须先停在 011)
fn apply_011(conn: &Connection) {
    apply(conn, MIGRATIONS[V_011 - 1], V_011 as i64).unwrap();
}

/// 老索引串(v11 边界,此时尚无 `entities_fts`)
fn fts_tags(conn: &Connection, id: i64) -> String {
    conn.query_row("SELECT tags FROM notes_fts WHERE rowid=?1", [id], |r| r.get(0))
        .unwrap()
}

/// 老 `notes_fts` 的 ≥3 字关键词命中数(直接 MATCH,不经过已被阶段 4 切到 `entities_fts` 的 query)
fn legacy_hits(conn: &Connection, keyword: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH ?1",
        [format!("\"{keyword}\"*")],
        |r| r.get(0),
    )
    .unwrap()
}

/// 终态索引串(实体 id)
fn entity_fts(conn: &Connection, id: i64) -> String {
    conn.query_row("SELECT tag_paths FROM entities_fts WHERE rowid=?1", [id], |r| r.get(0))
        .unwrap()
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

/// 011 之前:时间标签被排除在 tags 列外(009 的口径);跑 011 后时间标签进索引。
#[test]
fn migration_011_puts_time_tags_back_into_fts() {
    let conn = db_at_010();
    let id = seed_old_db(&conn);
    assert_eq!(fts_tags(&conn, id), "甲", "011 之前:时间标签不进索引(009 口径)");
    assert_eq!(legacy_hits(&conn, "2026"), 0, "011 之前:搜年份不命中时间标签");

    apply_011(&conn);

    let tags = fts_tags(&conn, id);
    assert!(tags.contains("甲"), "普通标签仍在索引里:{tags}");
    assert!(tags.contains("时间排序/2026/03/04"), "时间标签必须进索引(D3):{tags}");
    // 明示代价:搜年份/月份会命中该时段的全部笔记(一致性换来的)
    assert_eq!(legacy_hits(&conn, "2026"), 1);
    assert_eq!(legacy_hits(&conn, "历史笔记"), 1, "正文关键词不受影响");
    // 回填后 FTS 行数 = 笔记数(不多不少,没有悬空索引)
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM notes_fts"),
        count(&conn, "SELECT COUNT(*) FROM notes")
    );
}

/// ③ 设置键登记:缺失则写默认;已存在(用户改过)则保留
#[test]
fn migration_011_registers_settings_keys() {
    let conn = db_at_010();
    crate::db::repos::settings::set(&conn, "auto_time_tag", "false").unwrap();
    crate::db::repos::settings::set(&conn, "time_tag_template", "日期/{y}/{m}/{d}").unwrap();

    apply_011(&conn);

    let get = |k: &str| crate::db::repos::settings::get(&conn, k).unwrap();
    assert_eq!(get("auto_time_tag").as_deref(), Some("false"), "用户值不得被覆盖");
    assert_eq!(get("time_tag_template").as_deref(), Some("日期/{y}/{m}/{d}"));

    // 全新库:默认值与 timetag::DEFAULT_TEMPLATE 一致,开关为 true(v11 写默认)
    let fresh = Connection::open_in_memory().unwrap();
    for (i, sql) in MIGRATIONS.iter().enumerate().take(11) {
        apply(&fresh, sql, (i + 1) as i64).unwrap();
    }
    let get = |k: &str| crate::db::repos::settings::get(&fresh, k).unwrap();
    assert_eq!(get("auto_time_tag").as_deref(), Some("true"));
    assert_eq!(get("time_tag_template").as_deref(), Some(crate::timetag::DEFAULT_TEMPLATE));
}

/// ④ 幂等:重放 011 的 SQL 不改库(FTS 索引串/设置全等)
#[test]
fn migration_011_is_idempotent() {
    let conn = db_at_010();
    let id = seed_old_db(&conn);
    // 014 会删掉 saved_views,而 011 的 SQL 里有针对该表的 UPDATE,故重放前先停在 011
    apply_011(&conn);
    let snapshot = || {
        format!(
            "{}|{}|{}|{}",
            fts_tags(&conn, id),
            count(&conn, "SELECT COUNT(*) FROM notes_fts"),
            crate::db::repos::settings::get(&conn, "auto_time_tag").unwrap().unwrap(),
            crate::db::repos::settings::get(&conn, "time_tag_template").unwrap().unwrap(),
        )
    };
    let once = snapshot();

    conn.execute_batch(MIGRATIONS[V_011 - 1]).unwrap();
    assert_eq!(snapshot(), once, "重放 011 必须不改库");
}

/// ⑤ 终态的触发器(`entities_au`)与显式重写(`refresh_entities_fts`)口径一致。
#[test]
fn final_triggers_agree_with_refresh_entities_fts() {
    let mut conn = db_at_010();
    run(&conn).unwrap();
    assert_eq!(count(&conn, "PRAGMA user_version"), latest_version());
    let id = crate::db::repos::notes::create(&mut conn, "新笔记 #乙").unwrap().id;
    let created = entity_fts(&conn, id);
    assert!(created.contains('乙') && created.contains("时间排序"), "{created}");
    // 正文更新触发器(entities_au)
    conn.execute("UPDATE entities SET content='改过的正文' WHERE id=?1", [id]).unwrap();
    let updated = entity_fts(&conn, id);
    assert!(updated.contains('乙') && updated.contains("时间排序"), "{updated}");
    // 显式重写路径必须写出同一索引串
    conn.execute("DELETE FROM entities_fts WHERE rowid=?1", [id]).unwrap();
    crate::db::repos::tags::tree::refresh_entities_fts(&conn, &[id]).unwrap();
    assert_eq!(entity_fts(&conn, id), updated, "两条写入路径的索引串必须一致");
    // 终态用生产查询也能搜到
    let conds = crate::db::repos::notes::FilterConditions {
        keyword: Some("改过的正文".into()),
        ..Default::default()
    };
    assert_eq!(query(&conn, &conds, 0).unwrap().len(), 1);
}
