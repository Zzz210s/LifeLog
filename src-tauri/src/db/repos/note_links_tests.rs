//! `note_links` 仓库层用例:替换写入(已解析边落 `edges(kind='link')`)/ 双向读取(读 `edges`)。
//! 阶段 4(027)后老 `note_links` 表已下架,本文件全部对 `edges`/`entities` 断言。
//! 从 `note_links.rs` 挂载,仓库层函数按 `note_links::x` 调。
use crate::db::migrate;
use crate::db::repos::note_links;
use crate::db::repos::notes::{self, notes_filter::empty};
use rusqlite::Connection;

/// 内存库 + 跑完全部迁移。**显式开外键**:`edges` 与外键依赖它,
/// 而 `migrate::run` 不负责开(生产路径由 `db::open` 开,见 src-tauri/src/db/mod.rs)。
fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrate::run(&c).unwrap();
    c
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// 直接造笔记实体(阶段 4:边指向 `entities`,老 `notes` 表已不在)
/// 行仍写作 `(id,'note',正文,时间)`:第二列(旧 kind)由 `column3/column4` 跳过。
fn seed(c: &Connection, rows: &str) {
    c.execute_batch(&format!(
        "INSERT INTO entities(id, meta, created_at)
         SELECT column1, column3, column4 FROM (VALUES {rows});"
    ))
    .unwrap();
}

/// 某来源的已解析链接边 `(source_id, target_id)`,按 target 升序
fn edges_of(c: &Connection, source_id: i64) -> Vec<(i64, i64)> {
    c.prepare(
        "SELECT source_id, target_id FROM edges
         WHERE kind = 'link' AND source_id = ?1 ORDER BY target_id",
    )
    .unwrap()
    .query_map([source_id], |r| Ok((r.get(0)?, r.get(1)?)))
    .unwrap()
    .collect::<Result<_, _>>()
    .unwrap()
}

#[test]
fn replace_resolves_by_first_line() {
    let c = db();
    seed(&c, "(1,'note','目标笔记\n#日记','2026-01-01'),(2,'note','源','2026-01-02')");
    let n = note_links::replace(&c, 2, &["目标笔记".into(), "不存在的标题".into()]).unwrap();
    assert_eq!(n, 1, "只有一条解析成功");
    assert_eq!(edges_of(&c, 2), vec![(2, 1)], "未解析不落边(D2 选项 A)");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges WHERE kind='link'"), 1, "只有已解析的那条");
}

#[test]
fn replace_is_replacement_semantics() {
    let c = db();
    seed(&c, "(1,'note','甲','2026-01-01'),(2,'note','源','2026-01-02')");
    note_links::replace(&c, 2, &["甲".into()]).unwrap();
    note_links::replace(&c, 2, &["不存在".into()]).unwrap();
    assert!(edges_of(&c, 2).is_empty(), "第二次把已解析边整批替换掉");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges WHERE kind='link'"), 0);
}

#[test]
fn self_link_is_skipped() {
    let c = db();
    seed(&c, "(1,'note','自指','2026-01-01')");
    let n = note_links::replace(&c, 1, &["自指".into()]).unwrap();
    assert_eq!(n, 0, "指向自己不建边");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges WHERE kind='link'"), 0);
}

#[test]
fn duplicate_titles_take_earliest_id() {
    let c = db();
    seed(
        &c,
        "(7,'note','同名','2026-01-01'),(9,'note','同名','2026-01-02'),(2,'note','源','2026-01-03')",
    );
    note_links::replace(&c, 2, &["同名".into()]).unwrap();
    assert_eq!(edges_of(&c, 2), vec![(2, 7)], "重名取 id 最小(最早)的一条");
}

#[test]
fn duplicate_raw_title_in_one_note_is_one_row() {
    let c = db();
    seed(
        &c,
        "(1,'note','甲','2026-01-01'),(2,'note','源 [[甲]] 又 [[甲]]','2026-01-02')",
    );
    note_links::replace(&c, 2, &["甲".into(), "甲".into()]).unwrap();
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM edges WHERE kind='link' AND source_id = 2"),
        1,
        "同一目标写两遍只留一条边"
    );
}

#[test]
fn page_counts_group_by_target() {
    let c = db();
    seed(
        &c,
        "(1,'note','甲','2026-01-01'),(2,'note','源A','2026-01-02'),(3,'note','源B','2026-01-03')",
    );
    note_links::replace(&c, 2, &["甲".into()]).unwrap();
    note_links::replace(&c, 3, &["甲".into()]).unwrap();
    let m = note_links::list_links_page(&c, &[1, 2, 3]).unwrap();
    assert_eq!(m.get(&1), Some(&2), "甲 被引用 2 次");
    assert_eq!(m.get(&2), None, "没人引用源A");
    assert!(note_links::list_links_page(&c, &[]).unwrap().is_empty(), "空入参短路");
}

#[test]
fn list_note_links_returns_both_directions() {
    let c = db();
    seed(&c, "(1,'note','甲','2026-01-01'),(2,'note','源\n[[甲]]','2026-01-02')");
    note_links::replace(&c, 2, &["甲".into()]).unwrap();
    let out = note_links::list_note_links(&c, 2).unwrap();
    assert_eq!(out.outbound.len(), 1);
    assert_eq!(out.outbound[0].target_id, Some(1));
    assert_eq!(out.backlinks.len(), 0);
    let back = note_links::list_note_links(&c, 1).unwrap();
    assert_eq!(back.backlinks.len(), 1, "甲 有一条入链");
    assert_eq!(back.backlinks[0].source_id, 2);
    assert_eq!(back.backlinks[0].title, "源");
    assert_eq!(note_links::all_resolved(&c).unwrap(), vec![(2, 1)], "关系图读的已解析边");
}

#[test]
fn outbound_reparse_marks_renamed_target_unresolved() {
    // D2 选项 A:出链读时按标题重解析,目标改名后该链接退回未解析;已解析边与入链
    // 要等来源重新保存才更新(选项 A 的已知取舍)。
    let c = db();
    seed(&c, "(1,'note','甲','2026-01-01'),(2,'note','源 [[甲]]','2026-01-02')");
    note_links::replace(&c, 2, &["甲".into()]).unwrap();
    c.execute_batch("UPDATE entities SET meta='甲改' WHERE id=1;").unwrap();
    let out = note_links::list_note_links(&c, 2).unwrap();
    assert_eq!(out.outbound[0].raw_title, "甲", "正文原文不改");
    assert_eq!(out.outbound[0].target_id, None, "重解析不回已解析边 -> 未解析");
    assert_eq!(note_links::all_resolved(&c).unwrap(), vec![(2, 1)], "边仍在,等来源重新保存");
}

#[test]
fn outbound_page_batches_and_keeps_source_order() {
    let c = db();
    seed(
        &c,
        "(1,'note','甲','2026-01-01'),(2,'note','乙','2026-01-02'),
         (3,'note','源A [[甲]] [[乙]]','2026-01-03'),(4,'note','源B [[甲]]','2026-01-04')",
    );
    note_links::replace(&c, 3, &["甲".into(), "乙".into()]).unwrap();
    note_links::replace(&c, 4, &["甲".into()]).unwrap();
    let m = note_links::outbound_page(&c, &[3, 4, 99]).unwrap();
    assert_eq!(m.len(), 2, "没有出链/不存在的 id 不进 Map");
    let a = &m[&3];
    assert_eq!(
        a.iter().map(|l| l.raw_title.as_str()).collect::<Vec<_>>(),
        vec!["甲", "乙"],
        "按正文出现顺序"
    );
    assert_eq!(a[0].target_id, Some(1));
    assert_eq!(m[&4][0].title.as_deref(), Some("甲"), "显示标题随目标当前首行");
    assert!(note_links::outbound_page(&c, &[]).unwrap().is_empty(), "空入参短路");
}

#[test]
fn note_read_paths_carry_outbound_links() {
    let mut c = db();
    let target = notes::create_plain(&mut c, "目标笔记").unwrap();
    let source = notes::create_plain(&mut c, "源 [[目标笔记]] 又 [[不存在的标题]]").unwrap();
    assert_eq!(source.links.len(), 2, "单条读回(read_full)带出链,含未解析那条");
    assert_eq!(source.links[0].target_id, Some(target.id));
    assert_eq!(source.links[0].title.as_deref(), Some("目标笔记"));
    assert_eq!(source.links[1].target_id, None, "未解析仍显示一行(D2:不落边,读时重解析)");
    assert_eq!(source.links[1].raw_title, "不存在的标题");
    let page = notes::query(&c, &empty(), 0).unwrap();
    let got = page.iter().find(|n| n.id == source.id).unwrap();
    assert_eq!(got.links.len(), 2, "分页查询同样带出链(outbound_page 批量挂)");
}
