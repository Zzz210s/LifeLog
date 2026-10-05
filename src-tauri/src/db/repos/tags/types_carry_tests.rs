//! 标签类型与携带(R3 校验 / R8 历史行)及读方审计(spec 2026-10-05 / 计划 Task 6):
//! `set_carry` 的新写入目标必须是 `is_type=1` 的标签;历史未登记携带行原样保留;
//! 类型/认领写入不得污染笔记 tags 列、FTS、导出与被携带路径集合('type' 行对它们惰性)。
use super::*;
use crate::db::repos::carry_paths;
use crate::db::repos::notes;
use crate::db::repos::tags::{list_carries, set_carry};
use crate::db::{migrate, repos};
use crate::exchange::notes_export;
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

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", params![path], |r| r.get(0))
        .unwrap()
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn carry_rows(c: &Connection) -> i64 {
    count(c, "SELECT COUNT(*) FROM tag_links WHERE target_type='tag'")
}

fn fts_tags(c: &Connection, id: i64) -> String {
    c.query_row("SELECT tags FROM notes_fts WHERE rowid=?1", params![id], |r| r.get(0))
        .unwrap()
}

/// ① R3:携带目标未登记被拒、已登记成功;失败零写入
#[test]
fn set_carry_requires_registered_type_target() {
    let mut c = db();
    let author = ensure(&c, "作者/丸尾");
    let guo = ensure(&c, "国籍");
    let err = set_carry(&mut c, author, guo).unwrap_err();
    assert!(err.contains("类型标签"), "要中文提示目标须是类型: {err}");
    assert_eq!(carry_rows(&c), 0, "被拒时不写携带行");

    set_tag_type_flag(&c, guo, true).unwrap();
    set_carry(&mut c, author, guo).unwrap();
    assert_eq!(carry_rows(&c), 1, "登记为类型后携带成功");
}

/// ② R8:历史携带行(目标未登记)原样保留,且不受新校验影响;也能被正常读到
#[test]
fn legacy_carry_rows_survive_new_writes() {
    let mut c = db();
    let author = ensure(&c, "作者/丸尾");
    let lx = ensure(&c, "作者/鲁迅");
    let guo = ensure(&c, "国籍");
    // 历史行:直接写 tag_links(当年没有类型开关),绕过 set_carry 的校验
    c.execute(
        "INSERT INTO tag_links(tag_id, target_type, target_id) VALUES(?1, 'tag', ?2)",
        params![author, guo],
    )
    .unwrap();
    assert_eq!(carry_rows(&c), 1);

    let err = set_carry(&mut c, lx, guo).unwrap_err(); // 新写入同一目标仍被拒
    assert!(err.contains("类型标签"), "历史行豁免不等于放过新写入: {err}");
    assert_eq!(carry_rows(&c), 1, "历史行未被清掉也未新增");
    assert_eq!(list_carries(&c, guo).unwrap().carriers_of.len(), 1, "历史行仍可读");

    set_tag_type_flag(&c, guo, true).unwrap();
    set_carry(&mut c, lx, guo).unwrap();
    assert_eq!(carry_rows(&c), 2, "登记后新写入成功,历史行同时保留");
}

/// ③ 读方审计:写入类型标记与 'type' 行后,笔记 tags 列 / FTS / 导出 / 被携带路径集合全不变
#[test]
fn type_edges_do_not_change_note_tags_fts_or_export() {
    let mut c = db();
    let note = notes::create_plain(&mut c, "记录 #中国").unwrap();
    let zhong = id_at(&c, "中国");
    let tags_before = notes::read_full(&c, note.id).unwrap().unwrap().tags;
    let fts_before = fts_tags(&c, note.id);
    let export_before = notes_export::rows(&c).unwrap();
    let carried_before = carry_paths::carried_paths(&c).unwrap();

    let guo = ensure(&c, "国籍");
    set_tag_type_flag(&c, guo, true).unwrap();
    set_tag_types(&mut c, zhong, vec![guo]).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_links WHERE target_type='type'"), 1);

    assert_eq!(
        notes::read_full(&c, note.id).unwrap().unwrap().tags,
        tags_before,
        "类型不得混进笔记的 tags 列"
    );
    assert_eq!(fts_tags(&c, note.id), fts_before, "'type' 行不得改写 FTS 标签列");
    assert_eq!(notes_export::rows(&c).unwrap(), export_before, "导出内容不因类型而变");
    assert_eq!(
        carry_paths::carried_paths(&c).unwrap(),
        carried_before,
        "'type' 行不得被当成携带行读走"
    );
}
