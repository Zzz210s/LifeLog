//! 老库升级链(spec §7.5 / 计划 Task 1.2 用例 ⑦):`v23 -> 28` 与 `v26 -> 28` 各自一次跑到 28。
//! spec §5.4 十条对账要求 v31 结构(points/lines);本文件的库停在 v28/v30,故对账整组 N/A、不报错。
//! 起点库用「空库 + MIGRATIONS 顺序重放」构造(单测里没有真库副本)。
use super::*;
use crate::db::repos::entities::reconcile::assert_cache_matches_edges;

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// v23 起点(标签 id 整体偏移的时代之前):001..020 顺序重放 + 021/022/023 各自的钩子。
/// 与 `entities_tags_fixture::migrate_to_v23` 同序,这里不再种数据(空库路径)。
#[test]
fn upgrade_from_v23_to_latest_passes_reconcile() {
    let c = Connection::open_in_memory().unwrap();
    super::entities_tags_fixture::migrate_to_v23(&c);
    assert_eq!(count(&c, "PRAGMA user_version"), 23);

    run(&c).unwrap();
    assert_eq!(count(&c, "PRAGMA user_version"), latest_version());
    assert_eq!(count(&c, "SELECT COUNT(*) FROM pragma_foreign_key_check"), 0);
    assert_cache_matches_edges(&c);
}

/// v26 起点(刚迁完 024/025/026、带 `entities_fts_src` 视图与老 9 个触发器):
/// 027 必须把过渡视图与老触发器删净,028 再把表与边重建到新口径,029 用新列重建聚合视图。
#[test]
fn upgrade_from_v26_to_latest_passes_reconcile_and_drops_legacy_objects() {
    let c = super::entities_tags_fixture::migrated_to_v26();
    assert_eq!(count(&c, "PRAGMA user_version"), 26);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM sqlite_master WHERE name='entities_fts_src'"), 1);
    let legacy_view_sql: String =
        c.query_row("SELECT sql FROM sqlite_master WHERE name='entities_fts_src'", [], |r| r.get(0)).unwrap();
    assert!(legacy_view_sql.contains("tag_paths"), "026 的过渡视图用旧列");

    run(&c).unwrap();
    assert_eq!(count(&c, "PRAGMA user_version"), latest_version());
    let view_sql: String =
        c.query_row("SELECT sql FROM sqlite_master WHERE name='entities_fts_src'", [], |r| r.get(0)).unwrap();
    assert!(!view_sql.contains("tag_paths"), "029 重建的视图不再用旧列");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM pragma_foreign_key_check"), 0);
    assert_cache_matches_edges(&c);
}
