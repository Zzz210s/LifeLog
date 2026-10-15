//! 导出行为测试(自 notes_export.rs 拆出,守 200 行上限):
//! 导出 = 信息流**当前筛选结果**(settings.filter_current),列为 id / 正文(meta) /
//! 创建时间 / 引用路径列表(v31 非子级线闭包:树内点给路径,树外给标题)。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes::create_plain;
use crate::db::repos::settings::{self, FILTER_CURRENT_KEY};
use crate::db::repos::tags::rename;
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

/// 写入一份只含关键词的当前筛选(导出必须跟随它,而不是只导「全部实体」)
fn set_keyword_filter(c: &Connection, kw: &str) {
    settings::set(
        c,
        FILTER_CURRENT_KEY,
        &format!(
            r#"{{"groupOp":"and","groups":[{{"op":"and","items":[{{"kind":"keyword","value":"{kw}"}}]}}]}}"#
        ),
    )
    .unwrap();
}

fn ids(rows: &[Row]) -> Vec<i64> {
    rows.iter().map(|r| r.id).collect()
}

#[test]
fn export_headers_are_id_meta_created_at_and_refs() {
    // spec §6.6:列结构 = id, meta, created_at, 引用路径列表
    assert_eq!(HEADERS, ["id", "正文", "创建时间", "引用路径"]);
}

#[test]
fn rows_are_the_current_filter_result_not_only_notes() {
    let mut c = db();
    create_plain(&mut c, "记甲").unwrap();
    create_plain(&mut c, "记乙").unwrap();

    assert_eq!(rows(&c).unwrap().len(), 2, "默认筛选:全部树外实体");

    set_keyword_filter(&c, "甲");
    let hit = rows(&c).unwrap();
    assert_eq!(ids(&hit), vec![1], "导出跟随当前筛选取交集");
    assert_eq!(hit[0].meta, "记甲");
}

#[test]
fn broken_filter_falls_back_to_all_entities() {
    let mut c = db();
    create_plain(&mut c, "甲").unwrap();
    create_plain(&mut c, "乙").unwrap();
    settings::set(&c, FILTER_CURRENT_KEY, "{不是 JSON").unwrap();

    assert_eq!(rows(&c).unwrap().len(), 2, "坏条件退化为空条件(全部实体)");
}

#[test]
fn row_carries_id_meta_created_at_and_link_paths() {
    let mut c = db();
    create_plain(&mut c, "乙\n第二行").unwrap(); // 多行 -> 即使被引用进树仍在默认筛选内
    create_plain(&mut c, "记录 #甲 [[乙]]").unwrap();
    c.execute("UPDATE points SET created_at='2026-01-02' WHERE id=2", []).unwrap();

    let r = rows(&c).unwrap();
    assert_eq!(ids(&r), vec![2, 1], "按 id 降序(最新在前)");
    assert_eq!(r[0].meta, "记录 [[乙]]"); // `#标签` 剥掉,`[[链接]]` 原样留在正文
    assert_eq!(r[0].created_at, "2026-01-02");
    // 出链目标:树外实体用标题(乙),树内实体用路径(甲);按显示名升序(乙 < 甲)
    assert_eq!(r[0].refs, "乙 甲");
    assert_eq!(r[1].refs, "", "无出链的实体引用列为空");
}

#[test]
fn md_tag_name_exports_as_plain_text() {
    // 导出是给人看的文件:md 名字写可见文本,不把 `[郴](chēn)州市` 原样写进单元格
    let mut c = db();
    create_plain(&mut c, "莽山栈道 #地点/郴chen州市/宜章县").unwrap();
    let id: i64 = c
        .query_row("SELECT id FROM points WHERE path='地点/郴chen州市'", [], |r| r.get(0))
        .unwrap();
    rename(&mut c, id, "[郴](chēn)州市").unwrap();

    assert_eq!(rows(&c).unwrap()[0].refs, "地点/郴州市/宜章县");
}

#[test]
fn tagless_note_has_empty_refs_cell() {
    let mut c = db();
    create_plain(&mut c, "无标签").unwrap();

    let r = rows(&c).unwrap();
    assert_eq!(r[0].refs, "");
    assert_eq!(r[0].meta, "无标签");
    assert!(export_notes(&c).is_ok());
}

#[test]
fn refs_cell_omits_relation_name() {
    // 引用列 = 目标点的显示名;关系名(名字点文本)不得附进单元格(设计 §7.2 / T4)。
    let mut c = db();
    let note = create_plain(&mut c, "记录 #地点/日本").unwrap();
    c.execute(
        "INSERT INTO points(meta, is_cited, created_at) VALUES('国籍', 0, datetime('now','localtime'))",
        [],
    )
    .unwrap();
    let name_id = c.last_insert_rowid();
    c.execute("UPDATE lines SET name_id=?1 WHERE from_id=?2", rusqlite::params![name_id, note.id])
        .unwrap();

    let r = rows(&c).unwrap();
    let row = r.iter().find(|x| x.id == note.id).expect("笔记应在当前筛选内");
    assert_eq!(row.refs, "地点/日本", "引用列是目标路径,不附关系名");
}

#[test]
fn long_meta_is_truncated_with_mark() {
    let mut c = db();
    create_plain(&mut c, &"a".repeat(MAX_CELL_CHARS + 100)).unwrap();

    let cell = &rows(&c).unwrap()[0].meta;
    assert_eq!(cell.chars().count(), MAX_CELL_CHARS);
    assert!(cell.ends_with("…(导出已截断)"));
    assert!(cell.starts_with("aaaa"));
}

#[test]
fn overlong_refs_are_truncated_too() {
    // 引用列同一失效模式:聚合路径超上限时必须截断而非让整库导出失败
    let mut c = db();
    create_plain(&mut c, &format!("正文 #{}", "t".repeat(MAX_CELL_CHARS + 1))).unwrap();

    let r = rows(&c).unwrap();
    assert_eq!(r[0].meta, "正文");
    assert_eq!(r[0].refs.chars().count(), MAX_CELL_CHARS);
    assert!(r[0].refs.ends_with(TRUNCATE_MARK));
    assert!(export_notes(&c).is_ok());
}

#[test]
fn export_notes_produces_xlsx_bytes() {
    let mut c = db();
    create_plain(&mut c, "较早一条 #工作").unwrap();
    create_plain(&mut c, "较新一条 #生活 #工作").unwrap();

    let bytes = export_notes(&c).unwrap();
    // xlsx 即 zip 容器:开头魔数 PK\x03\x04
    assert_eq!(&bytes[0..4], &[0x50, 0x4B, 0x03, 0x04]);
    assert!(bytes.len() > 1000);
}

#[test]
fn export_notes_survives_overlong_meta() {
    let mut c = db();
    create_plain(&mut c, &"b".repeat(MAX_CELL_CHARS + 50)).unwrap();

    let bytes = export_notes(&c).unwrap();
    assert_eq!(&bytes[0..4], &[0x50, 0x4B, 0x03, 0x04]);
}

/// 真库只读验收(需 `LIFELOG_EXPORT_DB` 指向真库/副本;默认 ignored):
/// 导出行数必须 == 当前筛选条件现场重算的命中数,并打印首行验证列结构。
/// 跑法:`LIFELOG_EXPORT_DB="C:/Users/.../com.lifelog.app/lifelog.db" \
///       cargo test --lib export_real_db_readout -- --ignored --nocapture`
#[test]
#[ignore = "真库只读验收:需 LIFELOG_EXPORT_DB"]
fn export_real_db_readout() {
    let path = std::env::var("LIFELOG_EXPORT_DB").expect("未设 LIFELOG_EXPORT_DB");
    let c = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let entities: i64 = c.query_row("SELECT COUNT(*) FROM points", [], |r| r.get(0)).unwrap();
    let (frag, args) = where_clause(&current_filter(&c)).unwrap();
    let expected: i64 = c
        .query_row(
            &format!("SELECT COUNT(*) FROM points n WHERE ({frag})"),
            rusqlite::params_from_iter(args),
            |r| r.get(0),
        )
        .unwrap();
    let rows = rows(&c).unwrap();
    eprintln!("真库导出读数: entities={entities} 导出行数={} 筛选命中={expected}", rows.len());
    for r in rows.iter().take(2) {
        eprintln!("  id={} meta={:?} created_at={} refs={:?}", r.id, r.meta, r.created_at, r.refs);
    }
    assert_eq!(rows.len() as i64, expected, "导出行数 == 当前筛选命中数");
}
