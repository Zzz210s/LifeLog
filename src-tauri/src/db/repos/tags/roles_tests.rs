//! 标签角色(roles)与认领(tag_roles)数据层测试(spec 2026-10-05 §3 §4 R1-R5)。
//! 全部用内存库;真实库只读。夹具开 foreign_keys=ON:级联删除是被测行为,不能只看显式 DELETE。
//! 携带方向的 R3/R8 校验与读方审计拆到 `roles_carry_tests.rs`(守 200 行上限)。
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

/// ① 登记幂等;list_roles 给完整路径 + 末段名(角色名随路径现算)
#[test]
fn register_role_is_idempotent_and_lists_leaf_names() {
    let c = db();
    let guo = ensure(&c, "地点轴/国籍");
    register_role(&c, guo).unwrap();
    register_role(&c, guo).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM roles"), 1, "重复登记不增行");
    assert_eq!(
        list_roles(&c).unwrap(),
        vec![RoleRef { tag_id: guo, path: "地点轴/国籍".into(), name: "国籍".into() }]
    );
}

/// ② 取消登记幂等:连带删掉该角色的认领行
#[test]
fn unregister_role_clears_claims_and_is_idempotent() {
    let mut c = db();
    let guo = ensure(&c, "国籍");
    let zhong = ensure(&c, "中国");
    register_role(&c, guo).unwrap();
    set_tag_roles(&mut c, zhong, vec![guo]).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_roles"), 1);

    unregister_role(&mut c, guo).unwrap();
    unregister_role(&mut c, guo).unwrap(); // 幂等

    assert_eq!(count(&c, "SELECT COUNT(*) FROM roles"), 0);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_roles"), 0, "认领行随角色一起消失");
    assert!(list_tag_roles(&c, zhong).unwrap().is_empty());
}

/// ③ 认领是整体替换(不是增量):旧的被清掉;重复 role_id 幂等;空集合=清空;不串标签
#[test]
fn set_tag_roles_replaces_whole_set() {
    let mut c = db();
    let a = ensure(&c, "角色甲");
    let b = ensure(&c, "角色乙");
    let zhong = ensure(&c, "中国");
    let ri = ensure(&c, "日本");
    register_role(&c, a).unwrap();
    register_role(&c, b).unwrap();

    set_tag_roles(&mut c, zhong, vec![a, b]).unwrap();
    assert_eq!(list_tag_roles(&c, zhong).unwrap().len(), 2);
    set_tag_roles(&mut c, ri, vec![b]).unwrap();

    set_tag_roles(&mut c, zhong, vec![b]).unwrap(); // 整体替换:甲 被移除
    let after = list_tag_roles(&c, zhong).unwrap();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].tag_id, b, "只剩整体替换后的那个角色");
    assert_eq!(list_tag_roles(&c, ri).unwrap().len(), 1, "别的标签的认领不受影响");

    set_tag_roles(&mut c, zhong, vec![b, b]).unwrap(); // 重复项被主键去重
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_roles WHERE tag_id=(SELECT id FROM tags WHERE path='中国')"), 1);

    set_tag_roles(&mut c, zhong, vec![]).unwrap(); // 空集合 = 清空
    assert!(list_tag_roles(&c, zhong).unwrap().is_empty());
}

/// ④ 认领目标必须是已登记角色;被拒时零写入
#[test]
fn set_tag_roles_rejects_unregistered_role() {
    let mut c = db();
    let zhong = ensure(&c, "中国");
    let not_role = ensure(&c, "作者");
    let err = set_tag_roles(&mut c, zhong, vec![not_role]).unwrap_err();
    assert!(err.contains("已登记"), "要中文提示必须是已登记角色: {err}");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_roles"), 0, "被拒时零写入");
}

/// ⑤ 删除被登记为角色的标签:roles 行与相关 tag_roles 行由外键级联消失
#[test]
fn delete_role_tag_cascades_roles_and_claims() {
    let mut c = db();
    let guo = ensure_segs(&c, &["地点轴", "国籍"]);
    let zhong = ensure(&c, "中国");
    register_role(&c, guo).unwrap();
    register_role(&c, zhong).unwrap();
    set_tag_roles(&mut c, zhong, vec![guo]).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM roles"), 2);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_roles"), 1);
    let root = id_at(&c, "地点轴");

    delete_subtree(&mut c, root).unwrap(); // 连子孙"国籍"一起删

    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM roles WHERE tag_id={guo}")),
        0,
        "被删标签的 roles 行必须消失"
    );
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM tag_roles WHERE role_id={guo}")),
        0,
        "指向该角色的认领行必须消失"
    );
    assert_eq!(count(&c, "SELECT COUNT(*) FROM roles"), 1, "中国 的角色登记不受影响");
}

/// ⑥ 删除被认领的标签:它的认领行消失,角色本身还在
#[test]
fn delete_claimed_tag_cascades_claim_rows() {
    let mut c = db();
    let guo = ensure(&c, "国籍");
    let zhong = ensure(&c, "中国");
    register_role(&c, guo).unwrap();
    set_tag_roles(&mut c, zhong, vec![guo]).unwrap();

    delete_subtree(&mut c, zhong).unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_roles"), 0, "被删标签的认领行消失");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM roles"), 1, "角色仍登记着");
}

/// ⑦ 孤儿回收:已登记角色是"有用处的空壳",不得像无关空壳一样被回收
#[test]
fn gc_orphans_keeps_registered_role() {
    let c = db();
    let guo = ensure(&c, "国籍");
    register_role(&c, guo).unwrap();
    let junk = ensure(&c, "空壳");

    gc_orphans(&c).unwrap();

    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={guo}")), 1, "角色标签留下");
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM tags WHERE id={junk}")), 0, "无关空壳仍回收");
}

/// ⑧ 夹具自检:注册与认领不动 notes 表(本用例只钉"只写了这两张新表")
#[test]
fn role_writes_touch_only_role_tables() {
    let mut c = db();
    let note = notes::create_plain(&mut c, "记录 #中国").unwrap();
    let guo = ensure(&c, "国籍");
    register_role(&c, guo).unwrap();
    let zhong = id_at(&c, "中国");
    set_tag_roles(&mut c, zhong, vec![guo]).unwrap();
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM notes WHERE id={}", note.id)),
        1,
        "笔记行不受角色写入影响"
    );
}
