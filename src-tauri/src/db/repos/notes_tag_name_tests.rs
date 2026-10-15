//! 读取面的**名字上浮**用例(设计 §5.2):一条名线的名字必须从库里逐字节读回 IPC ——
//! 单条读回(`read_full`)、平铺分页尾查询(`notes_page::run_page`)、分组尾查询
//! (`notes_group_query::query_grouped` 的 5 列 GroupRow)三条路径各一条。
//! 末尾另有真库只读验收(`#[ignore]`,不写一个字节)。
use crate::db::migrate;
use crate::db::repos::notes::notes_filter::{FilterConditions, GroupByCond};
use crate::db::repos::notes::notes_group_query::{query_group_page, query_grouped};
use crate::db::repos::notes::notes_query::query;
use crate::db::repos::notes::{create_plain, read_full, NoteTag};
use crate::db::repos::tags::resolve_or_create_name_point;
use crate::db::repos::tags::test_support::with_note_domain;
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

/// 老用例口径的「笔记域」(见 `tags::test_support`):按条件过滤的入口都需要它,
/// 否则树内目标点也会出现在结果里。
fn ndc() -> FilterConditions {
    with_note_domain(FilterConditions::default())
}

/// 夹具:把「来源 -> 目标路径」那条无名字线改成**名线**,返回名字点 id。
/// 名字点走写路径同一份复用口径(`resolve_or_create_name_point`),不新开线 ——
/// 换名字 = 换 `name_id`(与 `set_tag_relation` 同口径)。
fn name_line(c: &Connection, from_id: i64, to_path: &str, name: &str) -> i64 {
    let name_id = resolve_or_create_name_point(c, name).unwrap();
    let n = c
        .execute(
            "UPDATE lines SET name_id = ?1
              WHERE from_id = ?2 AND to_id = (SELECT id FROM points WHERE path = ?3)",
            params![name_id, from_id, to_path],
        )
        .unwrap();
    assert_eq!(n, 1, "夹具:来源 {from_id} 到 {to_path} 的无名字线不存在");
    name_id
}

/// 断言用:从读回的标签集合里取指定路径的一条
fn tag_of(tags: &[NoteTag], path: &str) -> NoteTag {
    tags.iter()
        .find(|t| t.path == path)
        .cloned()
        .unwrap_or_else(|| panic!("没读回标签 {path}:{tags:?}"))
}

#[test]
fn read_full_exposes_relation_name() {
    let mut c = db();
    let n = create_plain(&mut c, "在日本吃拉面 #地点/日本").unwrap();
    // 无名字线:名字位是 None(前端据此把 chip 悬停回落到完整路径)
    assert_eq!(n.tags, vec![NoteTag { path: "地点/日本".into(), relation_name: None }]);
    name_line(&c, n.id, "地点/日本", "国籍");
    let back = read_full(&c, n.id).unwrap().unwrap();
    assert_eq!(
        back.tags,
        vec![NoteTag { path: "地点/日本".into(), relation_name: Some("国籍".into()) }],
        "名线的名字必须从库读回 IPC"
    );
}

#[test]
fn paged_read_carries_name() {
    let mut c = db();
    let n = create_plain(&mut c, "在日本吃拉面 #地点/日本").unwrap();
    name_line(&c, n.id, "地点/日本", "国籍");
    let got = query(&c, &ndc(), 0).unwrap();
    assert_eq!(got.len(), 1, "纯名字点不进基集(not_pure_name)");
    assert_eq!(tag_of(&got[0].tags, "地点/日本").relation_name.as_deref(), Some("国籍"));
}

#[test]
fn grouped_read_carries_name() {
    let mut c = db();
    let n = create_plain(&mut c, "在日本吃拉面 #地点/日本").unwrap();
    name_line(&c, n.id, "地点/日本", "国籍");
    let gb = GroupByCond { path: "地点".into(), dir: "asc".into() };
    let pages = query_grouped(&c, &ndc(), &gb).unwrap();
    assert_eq!(pages.len(), 1);
    assert_eq!(
        tag_of(&pages[0].notes[0].tags, "地点/日本").relation_name.as_deref(),
        Some("国籍"),
        "分组尾查询(5 列 GroupRow)必须带名字"
    );
    // 组内续页走的是平铺尾查询(`run_page`):同一条名线也得带名字(组键 = 一级子标签的完整路径)
    let more = query_group_page(&c, &ndc(), &gb, Some("地点/日本"), 0).unwrap();
    assert_eq!(tag_of(&more[0].tags, "地点/日本").relation_name.as_deref(), Some("国籍"));
}

/// 真库只读验收(不写一个字节):真库里 53 条名线的来源都是**树内点**,这里对每条名线
/// 取源点做一次 `read_full`,断言读回的 `relation_name` 与库里名字点的 `meta` 逐条一致。
/// 跑法:`LIFELOG_RO_DB=<真库或副本> cargo test --lib -- --ignored real_db_named_lines`。
#[test]
#[ignore = "真库只读验收:需 LIFELOG_RO_DB 指向真库(只读打开,不写一个字节)"]
fn real_db_named_lines_expose_relation_name() {
    let Ok(path) = std::env::var("LIFELOG_RO_DB") else {
        panic!("需 LIFELOG_RO_DB 指向真库");
    };
    let c = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let rows: Vec<(i64, String, String)> = c
        .prepare(
            "SELECT l.from_id, t.path, n.meta FROM lines l
               JOIN points t ON t.id = l.to_id
               JOIN points n ON n.id = l.name_id
              WHERE l.name_id IS NOT NULL AND l.name_id <> 0 AND t.path IS NOT NULL
              ORDER BY l.from_id, t.path",
        )
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert!(!rows.is_empty(), "真库应当有名线");
    for (from_id, path, name) in &rows {
        let note = read_full(&c, *from_id).unwrap().unwrap();
        assert_eq!(
            tag_of(&note.tags, path).relation_name.as_deref(),
            Some(name.as_str()),
            "源点 {from_id} 的 {path} 名字丢了"
        );
    }
    println!("真库只读:{} 条名线的来源点都读回了 relationName", rows.len());
}
