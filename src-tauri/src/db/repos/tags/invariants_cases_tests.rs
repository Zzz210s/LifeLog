//! 不变量的用例与自证(自 invariants_tests.rs 抽出,守 200 行上限):
//! 改名级联改写 filter_current;以及变异法证明 FTS 漂移检查真能报警。
use super::{assert_filter_paths_exist, assert_fts_matches_edges, assert_is_cited_matches_edges, assert_no_orphan_tags};
use crate::db::repos::entities::reconcile::assert_cache_matches_edges;
use crate::db::repos::settings::FILTER_CURRENT_KEY;
use crate::db::repos::tags;
use rusqlite::{params, Connection};

/// 路径变化类操作(改名)必须级联改写 filter_current,且改写后的引用真实存在(不变量③)。
#[test]
fn rename_cascades_filter_and_keeps_invariants() {
    let mut c = Connection::open_in_memory().unwrap();
    crate::db::migrate::run(&c).unwrap();
    crate::db::repos::notes::create_plain(&mut c, "会议记录 #工作/项目A").unwrap();
    let filter = r##"{"keyword":null,"tags":[{"path":"工作/项目A","includeChildren":true}],"excludeTags":[{"path":"工作","includeChildren":false}],"tagPresence":null,"sort":"newest","expr":"#工作/项目A"}"##;
    crate::db::repos::settings::set(&c, FILTER_CURRENT_KEY, filter).unwrap();
    let root = id_at(&c, "工作");

    crate::db::repos::tags::rename(&mut c, root, "事业").unwrap();

    let raw = crate::db::repos::settings::get(&c, FILTER_CURRENT_KEY).unwrap().unwrap();
    assert!(raw.contains("事业/项目A") && !raw.contains("工作"), "条件未级联: {raw}");
    assert_fts_matches_edges(&c);
    assert_no_orphan_tags(&c);
    assert_filter_paths_exist(&c);
}

/// 变异法可证伪:绕开所有写入口直接制造两种不一致,测试台必须报错 ——
/// ① 删掉实体索引行(FTS 漂移);② 直接删 tagging 边不留孤儿回收(孤儿检查命中)。
#[test]
fn fts_invariant_catches_manual_update_drift() {
    let mut c = Connection::open_in_memory().unwrap();
    crate::db::migrate::run(&c).unwrap();
    let note = crate::db::repos::notes::create_plain(&mut c, "x #甲").unwrap();
    let jia = id_at(&c, "甲");

    // 变异 ①:直接删点的索引行(绕开所有仓库层入口)
    c.execute("DELETE FROM points_fts WHERE rowid = ?1", params![note.id]).unwrap();
    let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| assert_fts_matches_edges(&c)))
        .expect_err("测试台必须抓到被删掉的 FTS 行");
    let msg = panic_message(err);
    assert!(msg.contains(&format!("点 {}", note.id)), "报错要带点 id: {msg}");
    assert!(msg.contains('甲'), "报错要带两侧取值: {msg}");

    // 变异 ②:直接删 tagging 边(edges_ad 会刷新 FTS,但甲确实成了孤儿)
    c.execute(
        "DELETE FROM lines WHERE (name_id IS NULL OR name_id <> 0) AND to_id = ?1",
        params![jia],
    )
    .unwrap();
    let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| assert_no_orphan_tags(&c)))
        .expect_err("孤儿检查必须抓到被改空的甲");
    assert!(panic_message(err).contains('甲'));
}

/// 测试台自身的读库入口:`SELECT id FROM entities WHERE path IS NOT NULL AND path = ?1`
fn id_at(conn: &Connection, path: &str) -> i64 {
    conn.query_row("SELECT id FROM points WHERE path IS NOT NULL AND path = ?1", params![path], |r| r.get(0))
        .unwrap()
}

/// 路径段助手(ensure_path 收 `&[String]`)
fn segs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

/// 表达式唯一索引 `idx_lines_uniq(from_id, to_id, COALESCE(name_id, -1))` 的三种冲突形态
/// (spec §3.2 / §17-E):同对两条无名字线 → 冲突;同对同名 → 冲突;同对不同名 → 允许。
/// 判别力:把索引里的 `COALESCE(name_id, -1)` 换成裸 `name_id`,SQLite 把两行 NULL 视作互不相同,
/// 「同对 NULL 重复」立刻变成可插入,本用例红(变异自证见计划 Task 3.5)。
#[test]
fn unique_index_blocks_null_duplicates() {
    let c = Connection::open_in_memory().unwrap();
    crate::db::migrate::run(&c).unwrap();
    c.execute(
        "INSERT INTO points(id,meta,created_at) VALUES
           (1,'甲','2026-01-01'),(2,'乙','2026-01-01'),(3,'名一','2026-01-01'),(4,'名二','2026-01-01')",
        [],
    )
    .unwrap();
    let line = |to: i64, name: Option<i64>| {
        c.execute(
            "INSERT INTO lines(from_id,to_id,name_id) VALUES(1,?1,?2)",
            params![to, name],
        )
    };
    // 形态①:同对无名字线重复
    line(2, None).unwrap();
    let e1 = line(2, None).unwrap_err().to_string();
    assert!(
        e1.contains("UNIQUE constraint failed") && e1.contains("idx_lines_uniq"),
        "同对 NULL 重复必须被唯一索引拦下: {e1}"
    );
    // 形态②:同对同名字重复
    line(2, Some(3)).unwrap();
    let e2 = line(2, Some(3)).unwrap_err().to_string();
    assert!(
        e2.contains("UNIQUE constraint failed") && e2.contains("idx_lines_uniq"),
        "同对同名重复必须被拦下: {e2}"
    );
    // 形态③:同对不同名允许(一条无名字 + 每个名字各一条)
    line(2, Some(4)).unwrap();
    let n: i64 = c.query_row("SELECT COUNT(*) FROM lines", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 3, "同对可并存:无名字 1 + 名一 1 + 名二 1");
}

/// 写路径串跑:建树 → 挂关系名 → 改名 → 删子树 → 删关系名线,收尾十条对账 + FTS/is_cited 不变量全过。
#[test]
fn write_path_serial_run_keeps_reconcile_green() {
    let mut c = Connection::open_in_memory().unwrap();
    crate::db::migrate::run(&c).unwrap();
    // 建树:id 1(工作)/2(项目A)/3(项目B)/4(待删),后两个的名字点从 id 5 起(删完不留断号)
    let a = tags::ensure_path(&c, &segs(&["工作", "项目A"])).unwrap();
    let b = tags::ensure_path(&c, &segs(&["工作", "项目B"])).unwrap();
    let d = tags::ensure_path(&c, &segs(&["工作", "待删"])).unwrap();
    // 关系名
    tags::set_tag_relation(&mut c, a, b, "国籍").unwrap();
    let nid: i64 = c
        .query_row("SELECT id FROM points WHERE meta='国籍' AND path IS NULL", [], |r| r.get(0))
        .unwrap();
    // 改名(24 条线会一起变,这里只有 1 条)
    tags::rename_line_name(&mut c, nid, "国别").unwrap();
    // 删子树(id 最大,不留断号)+ 删关系名线(名字点随之 GC)
    tags::delete_subtree(&mut c, d).unwrap();
    tags::remove_tag_relation(&mut c, a, b, Some(nid)).unwrap();
    assert_cache_matches_edges(&c);
    assert_fts_matches_edges(&c);
    assert_is_cited_matches_edges(&c);
}

/// 取 panic 载荷里的报错文本(assert_eq! / assert! 的载荷是 String)
fn panic_message(payload: Box<dyn std::any::Any + Send>) -> String {
    payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| payload.downcast_ref::<&str>().map(|s| s.to_string()))
        .unwrap_or_else(|| "<非字符串 panic>".to_string())
}
