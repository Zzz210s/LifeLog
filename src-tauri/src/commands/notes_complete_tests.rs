//! `complete_notes` 候选池的口径测试(测试先行):显示首行(大小写原样)、空标题排除、id 升序、
//! 前缀粗筛(子串档在前、子序列档在后)、空前缀回全池(前端会话内缓存,不封顶)。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes::create_plain;
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

/// 候选池 = **全部实体**的显示首行(spec §5.1:`[[ ]]` 池含标签实体):只裁空白、大小写原样;
/// 首行剥标签后为空的不进池;按 id 升序。
#[test]
fn all_titles_uses_display_title_and_skips_empty() {
    let mut c = db();
    create_plain(&mut c, "Hello World\n后续行").unwrap();
    create_plain(&mut c, "#只有标签").unwrap(); // 正文剥成空 -> 该笔记没有标题,排除
    create_plain(&mut c, "另一个 标题").unwrap();
    let got = repos::notes::all_titles(&c).unwrap();
    let pairs: Vec<(i64, &str)> = got.iter().map(|t| (t.id, t.title.as_str())).collect();
    // id=2 是笔记实体(正文空,排除);id=3 是 `#只有标签` 建出的标签实体(标题 = 标签名)
    assert_eq!(pairs, vec![(1, "Hello World"), (3, "只有标签"), (4, "另一个 标题")]);
}

/// 子串命中整档排在子序列命中之前;档内保持 id 升序(池本身就是 id 升序)
#[test]
fn pick_titles_substring_tier_before_subsequence() {
    let pool = vec![
        repos::notes::NoteTitle { id: 1, title: "MyLinkNotes".into() }, // 子序列: L i n k
        repos::notes::NoteTitle { id: 2, title: "LINK 甲".into() },     // 子串
        repos::notes::NoteTitle { id: 3, title: "L i n k".into() },     // 子序列
        repos::notes::NoteTitle { id: 4, title: "无关".into() },        // 不命中
    ];
    let ids: Vec<i64> = repos::notes::pick_titles(pool, "LINK").iter().map(|t| t.id).collect();
    assert_eq!(ids, vec![2, 1, 3]);
}

/// 空前缀回整池(上限内不截断):N9 要求一次取回、前端按 dataVersion 会话内缓存
#[test]
fn pick_titles_empty_prefix_returns_whole_pool() {
    let pool: Vec<repos::notes::NoteTitle> = (1..=250)
        .map(|id| repos::notes::NoteTitle { id, title: format!("标题{id}") })
        .collect();
    assert_eq!(repos::notes::pick_titles(pool, "").len(), 250);
}

/// 有前缀时整体上限 200;无命中回空
#[test]
fn pick_titles_caps_at_limit_and_returns_empty_without_hit() {
    let pool: Vec<repos::notes::NoteTitle> = (1..=250)
        .map(|id| repos::notes::NoteTitle { id, title: format!("x{id}") })
        .collect();
    let got = repos::notes::pick_titles(pool, "x");
    assert_eq!(got.len(), 200);
    assert_eq!(got[0].id, 1);
    assert!(repos::notes::pick_titles(Vec::new(), "x").is_empty());
}
