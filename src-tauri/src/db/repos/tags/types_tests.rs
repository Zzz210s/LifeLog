//! 标签类型(types)数据层测试(spec 2026-10-05 / 计划 Task 6):tags.is_type 开关 +
//! tag_links 的 'type' 行。全部用内存库;真实库只读。夹具开 foreign_keys=ON:级联删除是被测行为。
//! 携带方向的 R3/R8 校验与读方审计拆到 `types_carry_tests.rs`(守 200 行上限)。
use super::*;
use crate::db::repos::notes;
use crate::db::repos::tags::delete_subtree;
use crate::db::repos::tags::tree::gc_orphans;
use crate::db::{migrate, repos};
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    c
}

fn ensure(c: &Connection, path: &str) -> i64 {
    repos::tags::ensure_path(c, &[path.to_string()]).unwrap()
}

/// 多段路径建树(需要真正的父子层，如删除子树级联)
fn ensure_segs(c: &Connection, segs: &[&str]) -> i64 {
    repos::tags::ensure_path(c, &segs.iter().map(|s| s.to_string()).collect::<Vec<_>>()).unwrap()
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", params![path], |r| r.get(0))
        .unwrap()
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn type_edges(c: &Connection) -> i64 {
    count(c, "SELECT COUNT(*) FROM tag_links WHERE target_type = 'type'")
}

/// ① 设置标记幂等;list_types 给完整路径 + 末段名(类型名随路径现算)
#[test]
fn set_type_flag_is_idempotent_and_lists_leaf_names() {
    let c = db();
    let guo = ensure(&c, "地点轴/国籍");
    set_tag_type_flag(&c, guo, true).unwrap();
    set_tag_type_flag(&c, guo, true).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE is_type = 1"), 1, "重复登记不增行");
    assert_eq!(
        list_types(&c).unwrap(),
        vec![TypeRef { tag_id: guo, path: "地点轴/国籍".into(), name: "国籍".into() }]
    );
}

/// ② 取消标记幂等:连带删掉所有指向它的 'type' 行
#[test]
fn unset_type_flag_clears_edges_and_is_idempotent() {
    let mut c = db();
    let guo = ensure(&c, "国籍");
    let zhong = ensure(&c, "中国");
    set_tag_type_flag(&c, guo, true).unwrap();
    set_tag_types(&mut c, zhong, vec![guo]).unwrap();
    assert_eq!(type_edges(&c), 1);

    set_tag_type_flag(&c, guo, false).unwrap();
    set_tag_type_flag(&c, guo, false).unwrap(); // 幂等

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE is_type = 1"), 0);
    assert_eq!(type_edges(&c), 0, "指向它的类型行一起消失");
    assert!(list_tag_types(&c, zhong).unwrap().is_empty());
}

/// ③ 认领是整体替换(不是增量):旧的被清掉;重复 type 幂等;空集合=清空;不串标签
#[test]
fn set_tag_types_replaces_whole_set() {
    let mut c = db();
    let a = ensure(&c, "类型甲");
    let b = ensure(&c, "类型乙");
    let zhong = ensure(&c, "中国");
    let ri = ensure(&c, "日本");
    set_tag_type_flag(&c, a, true).unwrap();
    set_tag_type_flag(&c, b, true).unwrap();

    set_tag_types(&mut c, zhong, vec![a, b]).unwrap();
    assert_eq!(list_tag_types(&c, zhong).unwrap().len(), 2);
    set_tag_types(&mut c, ri, vec![b]).unwrap();

    set_tag_types(&mut c, zhong, vec![b]).unwrap(); // 整体替换:甲 被移除
    let after = list_tag_types(&c, zhong).unwrap();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].tag_id, b, "只剩整体替换后的那个类型");
    assert_eq!(list_tag_types(&c, ri).unwrap().len(), 1, "别的标签的认领不受影响");

    set_tag_types(&mut c, zhong, vec![b, b]).unwrap(); // 重复项被主键去重
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM tag_links WHERE target_type='type' \
                   AND tag_id=(SELECT id FROM tags WHERE path='中国')"),
        1
    );

    set_tag_types(&mut c, zhong, vec![]).unwrap(); // 空集合 = 清空
    assert!(list_tag_types(&c, zhong).unwrap().is_empty());
}

/// ④ 认领目标必须是已登记类型;被拒时零写入
#[test]
fn set_tag_types_rejects_unregistered_type() {
    let mut c = db();
    let zhong = ensure(&c, "中国");
    let not_type = ensure(&c, "作者");
    let err = set_tag_types(&mut c, zhong, vec![not_type]).unwrap_err();
    assert!(err.contains("已登记"), "要中文提示必须是已登记类型: {err}");
    assert_eq!(type_edges(&c), 0, "被拒时零写入");
}

/// ⑤ 删除被登记为类型的标签:is_type 标记随标签消失,指向它的 'type' 行被显式清掉
#[test]
fn delete_type_tag_cascades_flag_and_edges() {
    let mut c = db();
    let guo = ensure_segs(&c, &["地点轴", "国籍"]);
    let zhong = ensure(&c, "中国");
    set_tag_type_flag(&c, guo, true).unwrap();
    set_tag_type_flag(&c, zhong, true).unwrap();
    set_tag_types(&mut c, zhong, vec![guo]).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE is_type = 1"), 2);
    assert_eq!(type_edges(&c), 1);
    let root = id_at(&c, "地点轴");

    delete_subtree(&mut c, root).unwrap(); // 连子孙"国籍"一起删

    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={guo}")),
        0,
        "被删标签必须消失"
    );
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM tag_links WHERE target_type='type' AND target_id={guo}")),
        0,
        "指向该类型的 'type' 行必须显式清掉(target_id 无外键)"
    );
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM tags WHERE is_type = 1"),
        1,
        "中国 的类型标记不受影响"
    );
}

/// ⑥ 删除被认领的标签:它的 'type' 行消失,类型本身还在
#[test]
fn delete_claimed_tag_cascades_edges() {
    let mut c = db();
    let guo = ensure(&c, "国籍");
    let zhong = ensure(&c, "中国");
    set_tag_type_flag(&c, guo, true).unwrap();
    set_tag_types(&mut c, zhong, vec![guo]).unwrap();

    delete_subtree(&mut c, zhong).unwrap();

    assert_eq!(type_edges(&c), 0, "被删标签的 'type' 行消失");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE is_type = 1"), 1, "类型仍登记着");
}

/// ⑦ 孤儿回收:已登记类型是"有用处的空壳",不得像无关空壳一样被回收
#[test]
fn gc_orphans_keeps_registered_type() {
    let c = db();
    let guo = ensure(&c, "国籍");
    set_tag_type_flag(&c, guo, true).unwrap();
    let junk = ensure(&c, "空壳");

    gc_orphans(&c).unwrap();

    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={guo}")), 1, "类型标签留下");
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={junk}")), 0, "无关空壳仍回收");
}

/// ⑧ 夹具自检:登记与认领不动 notes 表
#[test]
fn type_writes_touch_only_notes_untouched() {
    let mut c = db();
    let note = notes::create_plain(&mut c, "记录 #中国").unwrap();
    let guo = ensure(&c, "国籍");
    set_tag_type_flag(&c, guo, true).unwrap();
    let zhong = id_at(&c, "中国");
    set_tag_types(&mut c, zhong, vec![guo]).unwrap();
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM notes WHERE id={}", note.id)),
        1,
        "笔记行不受类型写入影响"
    );
}
