//! 「沉尾」用例(信息流按 id 的时间序):只用来被引用 / 建立关系、自己没有正文的树内点
//! (自动时间标签、只作关系一端的框架标签)**沉到所有普通条目之后**,而不是凭新建时拿到的
//! 最大 id 占据最前。判据真源 [`feed_sink_predicate`],排序片段在 [`super::notes_page::build_order`]。
//! 逐条钉住判据的三条合取(去掉任一条,本文件必有用例转红):
//!   - 去掉 `path IS NOT NULL` → 无标签的纯正文笔记也被沉尾;
//!   - 去掉 `NOT EXISTS(... name_id IS NULL)` → 有出线的「关系源标签」被沉尾;
//!   - 多行(`meta` 含换行)标签不沉;纯名字点照旧不入基集(基集口径本次不动)。
//! 另钉:标签轴排序(`SortCond::Tag`)不长沉尾键(位置由轴的值决定),分页边界不重不漏。
use crate::db::repos::notes::notes_filter::*;
use crate::db::repos::notes::{query as query_all, Note};
use crate::db::migrate;
use rusqlite::Connection;

/// 夹具(点按 id = 创建序,时间序 = id 降序):
/// 1 无标签笔记 / 2 带标签笔记(→3) / 3 标签叶「轴/A」/ 4 容器标签「轴」(子级线 4→3)
/// / 5 带正文标签(多行 meta) / 6 关系源标签(出线 6→2) / 7 纯名字点(只在 name_id 位)。
fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c.execute_batch(
        "INSERT INTO points(id, meta, created_at, path, depth, is_cited) VALUES
           (1, '无标签笔记',   '2026-01-01', NULL,   NULL, 0),
           (2, '带标签笔记',   '2026-01-02', NULL,   NULL, 0),
           (3, 'A',            '2026-01-03', '轴/A', 2,    1),
           (4, '轴',           '2026-01-04', '轴',   1,    0),
           (5, '第一行
第二行', '2026-01-05', '长标签', 1, 1),
           (6, '来源',         '2026-01-06', '来源', 1,    1),
           (7, '关系名',       '2026-01-07', NULL,   NULL, 0);
         INSERT INTO lines(id, from_id, to_id, name_id) VALUES
           (1, 2, 3, NULL),   -- 笔记打标签(出无名线)
           (2, 4, 3, 0),      -- 结构边:轴 -> 轴/A
           (3, 6, 2, NULL),   -- 关系源标签引用笔记
           (4, 5, 2, 7);",    // 关系名点 7 只在 name_id 位
    )
    .unwrap();
    c
}

fn ids(notes: &[Note]) -> Vec<i64> {
    notes.iter().map(|n| n.id).collect()
}

fn feed(c: &Connection) -> Vec<i64> {
    ids(&query_all(c, &empty(), 0).unwrap())
}

/// 默认(时间降序)= `沉尾键 ASC, id DESC`:先普通条目 6/5/2/1,再沉尾项 4/3(类内仍 id 降序)。
#[test]
fn sink_entries_go_after_all_normal_entries() {
    assert_eq!(feed(&db()), vec![6, 5, 2, 1, 4, 3], "沉尾项必须在所有普通条目之后");
}

/// 逐条:三类「不沉」各自的理由 —— 无正文笔记不沉(没有 path)、带正文标签不沉(多行 meta)、
/// 关系源标签不沉(自己引用别人);纯名字点照旧不入基集。
#[test]
fn each_clause_of_the_sink_predicate_holds() {
    let got = feed(&db());
    let pos = |id: i64| got.iter().position(|&x| x == id).expect("条目应在流里");
    assert!(pos(1) < pos(4), "无标签笔记(1)不得沉尾");
    assert!(pos(5) < pos(4), "带标签笔记(2)与多行标签(5)都不得沉尾");
    assert!(pos(6) < pos(4), "关系源标签(6,自己有出线)不得沉尾");
    assert!(!got.contains(&7), "纯名字点(7)不入基集(本次不动该口径)");
    assert_eq!(got.iter().filter(|&&id| id == 3 || id == 4).count(), 2, "沉尾项不被丢");
}

/// 反向:沉尾项恒在末两位,且第一页(offset 0)里排在普通条目之后 —— 不允许跑到最前。
#[test]
fn sink_entries_never_precede_normal_entries() {
    let got = feed(&db());
    assert_eq!(&got[got.len() - 2..], &[4, 3], "沉尾类:容器标签(4)在其叶子(3)之前");
    assert_eq!(got[0], 6, "头部是最新的普通条目,不是自动/框架标签");
}

/// 标签轴排序不长沉尾键:位置由轴的值 + id 兜底决定 —— 沉尾标签 3 / 4(id 小于 5)仍排在普通
/// 笔记 5 之前(若长了沉尾键,4 必在 5 之后)。轴值分组照旧(NONE 组最后,第二键 = id asc)。
#[test]
fn tag_axis_sort_is_left_alone() {
    let c = db();
    let cond = FilterConditions {
        sorts: vec![SortCond::Tag { path: "轴".into(), dir: "asc".into(), enabled: true }],
        ..empty()
    };
    let got = ids(&query_all(&c, &cond, 0).unwrap());
    assert_eq!(got, vec![2, 1, 3, 4, 5, 6], "有轴值(2)在前,其余按 id asc;沉尾键不参与");
    let pos = |v: &Vec<i64>, id: i64| v.iter().position(|&x| x == id).unwrap();
    assert!(pos(&got, 4) < pos(&got, 5), "沉尾键若在,容器标签(4)会被压到 5 之后");
}

/// 分页边界:60 条普通笔记 + 3 条沉尾标签(新建 => 最大 id)。
/// 第一页 50 条全是普通笔记(60..11),第二页 10 条普通 + 3 条沉尾(10..1, 63, 62, 61);
/// 逐页断言不重、不漏,并集 = 全部 63 条。
fn paged_db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    for i in 1..=60 {
        c.execute(
            "INSERT INTO points(id, meta, created_at) VALUES(?1, ?2, '2026-01-01')",
            rusqlite::params![i, format!("笔记{i}")],
        )
        .unwrap();
    }
    for id in 61..=63 {
        c.execute(
            "INSERT INTO points(id, meta, created_at, path, depth, is_cited)
             VALUES(?1, ?2, '2026-01-01', ?3, 1, 1)",
            rusqlite::params![id, format!("标签{id}"), format!("标签{id}")],
        )
        .unwrap();
        c.execute(
            "INSERT INTO lines(id, from_id, to_id, name_id)
             VALUES(?1, 1, ?2, NULL)",
            rusqlite::params![id, id],
        )
        .unwrap();
    }
    c
}

#[test]
fn pagination_boundary_has_no_dup_and_no_gap() {
    let c = paged_db();
    let page1 = feed(&c);
    let page2 = ids(&query_all(&c, &empty(), 50).unwrap());
    assert_eq!(page1, (11..=60).rev().collect::<Vec<i64>>(), "第一页不含任何沉尾项");
    assert_eq!(page2, vec![10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 63, 62, 61], "第二页尾部才是沉尾项");
    let mut all: Vec<i64> = page1.iter().chain(page2.iter()).copied().collect();
    let n = all.len();
    all.sort_unstable();
    all.dedup();
    assert_eq!(all.len(), n, "两页之间不得重复");
    assert_eq!(all, (1..=63).collect::<Vec<i64>>(), "两页并集 = 全部 63 条,不漏");
}
