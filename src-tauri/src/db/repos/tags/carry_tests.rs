//! 标签携带标签数据层测试(spec 2026-10-05 §3 §4 / R1)。
//! 复用 tag_links 的 `target_type='tag'` 行:tag_id 是携带者,target_id 是被携带的标签。
use super::*;
use crate::db::repos::notes;
use crate::db::repos::tags::set_tag_type_flag;
use crate::db::{migrate, repos};
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

/// 建/取一个标签(测试夹具;不触发孤儿回收)
fn ensure(c: &Connection, path: &str) -> i64 {
    repos::tags::ensure_path(c, &[path.to_string()]).unwrap()
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", params![path], |r| r.get(0))
        .unwrap()
}

/// 当前 'tag' 行数(携带关系的唯一存储读数)
fn carry_rows(c: &Connection) -> i64 {
    c.query_row(
        "SELECT COUNT(*) FROM tag_links WHERE target_type='tag'",
        [],
        |r| r.get(0),
    )
    .unwrap()
}

/// ① 添加携带:多一行 'tag',list 两个方向都能读到
#[test]
fn set_carry_adds_row_and_lists_both_directions() {
    let mut c = db();
    let jia = ensure(&c, "甲");
    let yi = ensure(&c, "乙");
    assert_eq!(carry_rows(&c), 0);
    set_tag_type_flag(&c, yi, true).unwrap();

    set_carry(&mut c, jia, yi).unwrap();

    assert_eq!(carry_rows(&c), 1);
    let from_jia = list_carries(&c, jia).unwrap();
    assert_eq!(from_jia.carried, vec![TagRef { id: yi, path: "乙".into() }]);
    assert!(from_jia.carriers_of.is_empty());
    let from_yi = list_carries(&c, yi).unwrap();
    assert!(from_yi.carried.is_empty());
    assert_eq!(from_yi.carriers_of, vec![TagRef { id: jia, path: "甲".into() }]);
}

/// ② 幂等:重复添加不增行,list 仍只列一条
#[test]
fn set_carry_is_idempotent() {
    let mut c = db();
    let jia = ensure(&c, "甲");
    let yi = ensure(&c, "乙");
    set_tag_type_flag(&c, yi, true).unwrap();
    set_carry(&mut c, jia, yi).unwrap();
    set_carry(&mut c, jia, yi).unwrap();
    assert_eq!(carry_rows(&c), 1);
    assert_eq!(list_carries(&c, jia).unwrap().carried.len(), 1);
}

/// ③ 自携带被拒且不写库
#[test]
fn set_carry_rejects_self_carry() {
    let mut c = db();
    let jia = ensure(&c, "甲");
    let err = set_carry(&mut c, jia, jia).unwrap_err();
    assert!(err.contains("自己"), "要中文提示不能携带自己: {err}");
    assert_eq!(carry_rows(&c), 0);
}

/// ④ A→B→A 环被拒且不写第二行
#[test]
fn set_carry_rejects_two_node_cycle() {
    let mut c = db();
    let a = ensure(&c, "甲");
    let b = ensure(&c, "乙");
    set_tag_type_flag(&c, a, true).unwrap();
    set_tag_type_flag(&c, b, true).unwrap();
    set_carry(&mut c, a, b).unwrap();
    let err = set_carry(&mut c, b, a).unwrap_err();
    assert!(err.contains("循环"), "要中文提示会形成循环: {err}");
    assert_eq!(carry_rows(&c), 1);
}

/// ⑤ A→B→C→A 环被拒且不写第三行
#[test]
fn set_carry_rejects_three_node_cycle() {
    let mut c = db();
    let a = ensure(&c, "甲");
    let b = ensure(&c, "乙");
    let d = ensure(&c, "丙");
    set_tag_type_flag(&c, a, true).unwrap();
    set_tag_type_flag(&c, b, true).unwrap();
    set_tag_type_flag(&c, d, true).unwrap();
    set_carry(&mut c, a, b).unwrap();
    set_carry(&mut c, b, d).unwrap();
    let err = set_carry(&mut c, d, a).unwrap_err();
    assert!(err.contains("循环"), "要中文提示会形成循环: {err}");
    assert_eq!(carry_rows(&c), 2);
}

/// ⑥ 移除:行消失;重复移除仍成功(幂等)
#[test]
fn remove_carry_deletes_row_and_is_idempotent() {
    let mut c = db();
    let jia = ensure(&c, "甲");
    let yi = ensure(&c, "乙");
    set_tag_type_flag(&c, yi, true).unwrap();
    set_carry(&mut c, jia, yi).unwrap();
    remove_carry(&mut c, jia, yi).unwrap();
    assert_eq!(carry_rows(&c), 0);
    assert!(list_carries(&c, jia).unwrap().carried.is_empty());
    // 幂等:再删一次不报错
    remove_carry(&mut c, jia, yi).unwrap();
    assert_eq!(carry_rows(&c), 0);
}

/// ⑦ 不存在的标签给中文报错(两端都校验)
#[test]
fn set_carry_rejects_missing_tag() {
    let mut c = db();
    let jia = ensure(&c, "甲");
    let err = set_carry(&mut c, jia, 999_999).unwrap_err();
    assert!(err.contains("不存在"), "被携带方不存在要给中文错: {err}");
    let err = set_carry(&mut c, 999_999, jia).unwrap_err();
    assert!(err.contains("不存在"), "携带方不存在要给中文错: {err}");
    assert_eq!(carry_rows(&c), 0);
}

/// ⑧ R1:插入 'tag' 行后笔记的 tags 列与 FTS 标签列都不变。
/// 用例刻意让**被携带标签的 id 等于这条笔记的 id**(首个标签与首条笔记都拿 id 1):
/// `tag_links` 的 'tag' 行 target_id 因此会与笔记 id 撞号 —— 任何漏掉
/// `target_type='note'` 的读方都会把携带行当成这条笔记的链接(强变异敏感)。
#[test]
fn carry_rows_do_not_change_note_tags_or_fts() {
    let mut c = db();
    let note = notes::create_plain(&mut c, "记录 #甲").unwrap();
    let jia = id_at(&c, "甲");
    let yi = ensure(&c, "乙");
    assert_eq!(jia, note.id, "测试前提:首个标签与首条笔记都拿到 id 1");
    let tags_before = repos::notes::read_full(&c, note.id).unwrap().unwrap().tags;
    let fts_before: String = c
        .query_row("SELECT tags FROM notes_fts WHERE rowid=?1", params![note.id], |r| r.get(0))
        .unwrap();
    set_tag_type_flag(&c, jia, true).unwrap(); // 校验:目标必须是类型标签(R3)

    set_carry(&mut c, yi, jia).unwrap(); // 乙 携带 甲(target_id = note.id,故意撞号)

    let tags_after = repos::notes::read_full(&c, note.id).unwrap().unwrap().tags;
    let fts_after: String = c
        .query_row("SELECT tags FROM notes_fts WHERE rowid=?1", params![note.id], |r| r.get(0))
        .unwrap();
    assert_eq!(tags_after, vec!["甲".to_string()], "'tag' 行不得混进笔记的 tags 列");
    assert_eq!(tags_before, tags_after, "插入携带行不得改变笔记的 tags 列");
    assert_eq!(fts_before, fts_after, "插入携带行不得改写 FTS 标签列");
}

/// ⑨ 删除确认读数:count_carriers 与 list 的 carriersOf 口径一致(都只数直接携带者)
#[test]
fn count_carriers_counts_direct_carriers() {
    let mut c = db();
    let jia = ensure(&c, "甲");
    let yi = ensure(&c, "乙");
    let bing = ensure(&c, "丙");
    assert_eq!(count_carriers(&c, bing).unwrap(), 0, "没人携带时读数为 0");
    set_tag_type_flag(&c, bing, true).unwrap();

    set_carry(&mut c, jia, bing).unwrap();
    set_carry(&mut c, yi, bing).unwrap();

    assert_eq!(count_carriers(&c, bing).unwrap(), 2, "两个标签携带丙");
    assert_eq!(count_carriers(&c, jia).unwrap(), 0, "携带方自己不算被携带");
    // 与双向读数真比一次:carriersOf 的条数就是 count_carriers,carried 是反方向不混入
    let bing_report = list_carries(&c, bing).unwrap();
    assert_eq!(bing_report.carriers_of.len() as i64, count_carriers(&c, bing).unwrap());
    assert!(bing_report.carried.is_empty(), "丙不携带别人");
    let jia_report = list_carries(&c, jia).unwrap();
    assert_eq!(jia_report.carriers_of.len() as i64, count_carriers(&c, jia).unwrap());
    assert_eq!(jia_report.carried.len(), 1, "甲携带丙");
}
