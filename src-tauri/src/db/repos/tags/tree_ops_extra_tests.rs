//! 结构操作补充测试(自 tags_tree_ops_tests.rs 拆出以守 200 行上限):
//! 小账 B(impact 去重笔记数)、小账 D(move_to 回收空容器)与小账 E(深层移动被允许)。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes;
use crate::db::repos::tags::invariants_tests::{
    assert_filter_paths_exist, assert_fts_matches_edges, assert_no_orphan_tags,
};
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
    c.query_row("SELECT id FROM points WHERE path IS NOT NULL AND path=?1", [path], |r| r.get(0))
        .unwrap()
}

/// 小账 B:impact 第二项是去重后的笔记数,一条笔记同时链父与子标签时只计 1
#[test]
fn impact_second_is_distinct_note_count() {
    let mut c = db();
    let n = notes::create_plain(&mut c, "纪要 #工作 #工作/项目A").unwrap();
    let root = id_at(&c, "工作");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM lines l JOIN points s ON s.id = l.from_id JOIN points t ON t.id = l.to_id WHERE (l.name_id IS NULL OR l.name_id <> 0) AND (s.path IS NOT NULL OR t.path IS NOT NULL) AND (CASE WHEN s.path IS NOT NULL THEN l.from_id ELSE l.to_id END) IN (SELECT id FROM points WHERE path IS NOT NULL)"), 2);
    assert_eq!(impact(&c, root).unwrap(), (1, 1), "两行链接指向同一条笔记,笔记数仍为 1");
    assert_eq!(n.tags.len(), 2);
}

/// 小账 D:移走最后的子节点后,变成空容器的旧父级一并回收(与 delete_subtree 同口径)
#[test]
fn move_out_last_child_recycles_emptied_parent() {
    let mut c = db();
    notes::create_plain(&mut c, "纪要 #工作/项目A").unwrap();
    let leaf = id_at(&c, "工作/项目A");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM points WHERE path IS NOT NULL"), 2);

    move_to(&mut c, leaf, None).unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM points WHERE path IS NOT NULL AND path='工作'"), 0, "空容器父级回收");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM points WHERE path IS NOT NULL AND path='项目A' AND parent_id IS NULL"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM lines l JOIN points s ON s.id = l.from_id JOIN points t ON t.id = l.to_id WHERE (l.name_id IS NULL OR l.name_id <> 0) AND (s.path IS NOT NULL OR t.path IS NOT NULL) AND (CASE WHEN s.path IS NOT NULL THEN l.from_id ELSE l.to_id END)=(SELECT id FROM points WHERE path IS NOT NULL AND path='项目A')"), 1);
    assert_fts_matches_edges(&c);
    assert_no_orphan_tags(&c);
}

/// 小账 E:深层移动被允许 —— 2026-09-28 取消层级深度上限,原子树整体顺延(路径/深度/FTS 一致)
#[test]
fn move_beyond_former_max_depth_is_allowed() {
    let mut c = db();
    notes::create_plain(&mut c, "深处 #a1/a2/a3/a4/a5").unwrap();
    let x = ensure_path(&c, &["x".to_string()]).unwrap();
    let deepest = id_at(&c, "a1/a2/a3/a4/a5");

    let a1 = id_at(&c, "a1");
    move_to(&mut c, a1, Some(x)).unwrap();

    // 原 5 层子树整体下移一层:最深节点变成第 6 层(旧上限恰好是 5)
    assert_eq!(id_at(&c, "x/a1/a2/a3/a4/a5"), deepest);
    let deep = "path='x/a1/a2/a3/a4/a5'";
    assert_eq!(count(&c, &format!("SELECT depth FROM points WHERE path IS NOT NULL AND {deep}")), 6);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM points WHERE path IS NOT NULL AND path='a1'"), 0, "旧根路径不残留");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM points WHERE path IS NOT NULL"), 6);
    // FTS 跟着新路径走
    let fts: String = c.query_row("SELECT paths FROM points_fts", [], |r| r.get(0)).unwrap();
    assert!(fts.contains("x/a1/a2/a3/a4/a5"), "FTS 未跟上新路径:{fts}");
    assert_fts_matches_edges(&c);
    assert_no_orphan_tags(&c);
    assert_filter_paths_exist(&c);
}

/// 对账 ②(计划 T3.1):移动后 `points.parent_id`(派生缓存)与子级线
/// `lines(name_id = 0)`(树真源)必须一致 —— 先断旧子级线再建新线,不能只改缓存。
#[test]
fn move_keeps_parent_id_and_tree_line_in_sync() {
    let mut c = db();
    notes::create_plain(&mut c, "a #工作/项目A").unwrap();
    notes::create_plain(&mut c, "b #生活").unwrap();
    let leaf = id_at(&c, "工作/项目A");
    let work = id_at(&c, "工作");
    let life = id_at(&c, "生活");

    move_to(&mut c, leaf, Some(life)).unwrap();

    let life2 = id_at(&c, "生活");
    // 派生缓存:parent_id 指向新父
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM points WHERE id={leaf} AND parent_id={life2}")),
        1,
        "parent_id 未跟到新父"
    );
    // 树真源:恰好一条子级线 新父 -> 子
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM lines WHERE name_id=0 AND from_id={life2} AND to_id={leaf}")),
        1,
        "缺 新父 -> 子 的子级线"
    );
    // 旧父的子级线已断开
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM lines WHERE name_id=0 AND from_id={work} AND to_id={leaf}")),
        0,
        "旧父 -> 子 的子级线残留"
    );
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM lines WHERE name_id=0 AND to_id={leaf}")), 1, "一个子只能有一条入子级线");
}

/// 验收探针(默认忽略):在 v31 真库副本上现场跑「建树 / 移动 / 重排 / 改名 / 保存笔记」,
/// 结束后把探针建的子树与笔记清理干净(闭包与子级线回到现场前),再交给
/// `node scripts/entity-migration/reconcile.mjs --db <副本>` 对账。用法:
/// `LIFELOG_COPY_DB=<副本> cargo test --lib -- --ignored write_path_five_steps_on_copy --nocapture`
#[test]
#[ignore = "需要 LIFELOG_COPY_DB 指向 v31 副本"]
fn write_path_five_steps_on_copy() {
    let path = std::env::var("LIFELOG_COPY_DB").expect("需设 LIFELOG_COPY_DB");
    let mut c = Connection::open(&path).unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    crate::db::sql_functions::register(&c).unwrap();
    let closure = |c: &Connection| {
        crate::db::repos::entities::closure::tree_closure_ids(c).unwrap().len()
    };
    let child_lines = |c: &Connection| count(c, "SELECT COUNT(*) FROM lines WHERE name_id = 0");
    let (c0, l0) = (closure(&c), child_lines(&c));

    // ① 建树:#验收探测/树A/叶1、叶2(自动建中间层);同时存一条笔记让两个叶子不被 GC
    let root = ensure_path(&c, &["验收探测".into()]).unwrap();
    let tree_a = ensure_path(&c, &["验收探测".into(), "树A".into()]).unwrap();
    ensure_path(&c, &["验收探测".into(), "树A".into(), "叶1".into()]).unwrap();
    ensure_path(&c, &["验收探测".into(), "树A".into(), "叶2".into()]).unwrap();
    // ⑤ 保存笔记(标签一次落无名字线;两条标签引住两个叶子)
    let n1 = notes::create_plain(&mut c, "探针一 #验收探测/树A/叶1 #验收探测/树A/叶2").unwrap();
    let leaf1 = id_at(&c, "验收探测/树A/叶1");
    let leaf2 = id_at(&c, "验收探测/树A/叶2");
    // ④ 改名:树A -> 树B(子树 path 前缀重写 + 别名登记)
    rename(&mut c, tree_a, "树B").unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM points WHERE path = '验收探测/树B'"), 1);
    assert_eq!(id_at(&c, "验收探测/树B/叶1"), leaf1, "改名后叶子 id 不变、路径随前缀");
    // ② 移动:叶1 挂到根 验收探测 下(断旧子级线、建新线、parent_id/path/depth 同步)
    move_to(&mut c, leaf1, Some(root)).unwrap();
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM lines WHERE name_id=0 AND from_id={root} AND to_id={leaf1}")),
        1,
        "移动后 新父 -> 子 子级线"
    );
    assert_eq!(id_at(&c, "验收探测/叶1"), leaf1);
    // ③ 重排:叶2 插到叶1 之前(同父,整层重写 sort_order)
    move_beside(&mut c, leaf2, leaf1, false).unwrap();
    assert_eq!(id_at(&c, "验收探测/叶2"), leaf2, "重排后路径随父级");
    // ⑤ 保存笔记:再存一条引用改名后的路径
    let n2 = notes::create_plain(&mut c, "探针二 #验收探测/树B").unwrap();
    println!("PROBE 五步后 closure={} child_lines={}", closure(&c), child_lines(&c));

    // 清理:整棵探针子树 + 两条探针笔记,恢复现场前读数
    delete_subtree(&mut c, root).unwrap();
    notes::delete(&mut c, n1.id).unwrap();
    notes::delete(&mut c, n2.id).unwrap();
    let (c1, l1) = (closure(&c), child_lines(&c));
    println!("PROBE 清理后 closure={c1} child_lines={l1}(现场前 {c0}/{l0})");
    assert_eq!((c1, l1), (c0, l0), "探针必须净零变更");
}
