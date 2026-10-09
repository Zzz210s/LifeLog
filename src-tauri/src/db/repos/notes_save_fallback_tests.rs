//! T6 兜底解析读数(tag-label-md,2026-09-26):保存路径要吃得住「UI 编辑态往返」。
//! 前端 composeSource 把标签按**原始路径**拼回正文(`#地点/…/[郴](chēn)州市/宜章县`),
//! 而 md 名字里的 `[` 不在正文名称字符集里:严格扫描在此截断 —— 旧实现会静默删掉标签,
//! 并把这行 md 源码写进正文变成死文本。这里用真实的 create/update 路径复现并钉住兜底行为。
use super::*;
use crate::db::migrate;
use crate::db::repos::tags::invariants_tests::{assert_fts_matches_edges, assert_no_orphan_tags};
use crate::db::repos::tags::rename;
use rusqlite::Connection;

/// 改名前的中间段(正文语法可写)与改名后的 md 形态叶子路径
const PLAIN_MID: &str = "地点/中国大陆/湖南省/郴chen州市";
const MD_LEAF: &str = "地点/中国大陆/湖南省/[郴](chēn)州市/宜章县";

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    crate::db::repos::tags::test_support::install_legacy_name_views(&c);
    c
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", [path], |r| r.get(0)).unwrap()
}

/// 库内全部标签路径(升序,用于"一个节点也不许新建"的整表比对)
fn paths(c: &Connection) -> Vec<String> {
    let mut stmt = c.prepare("SELECT path FROM tags ORDER BY path").unwrap();
    let rows = stmt.query_map([], |r| r.get(0)).unwrap();
    rows.collect::<rusqlite::Result<Vec<String>>>().unwrap()
}

/// 与真实库同形的前置:五层路径,中间那段改名成 md 形态(纯文本形态自动登记为别名)
fn seed_md_note(c: &mut Connection, body: &str) -> i64 {
    let n = create_plain(c, &format!("{body} #{PLAIN_MID}/宜章县")).unwrap();
    let mid = id_at(c, PLAIN_MID);
    rename(c, mid, "[郴](chēn)州市").unwrap();
    let tags = read_full(c, n.id).unwrap().unwrap().tags;
    assert_eq!(tags, vec![MD_LEAF.to_string()], "前置:笔记链的叶子路径已是 md 形态");
    n.id
}

/// 复现(先红):编辑笔记 —— 正文 + 换行 + 每标签一行 `#原始路径`(前端 composeSource 同一形态)。
/// 末行为纯标签行时内容以 `\n` 结尾:普通标签同款的既有口径(notes_strip_tests
/// 的 trailing_tag_line_leaves_short_content_newline_terminated 明钉),md 标签现在与它一致。
/// 再走一次往返必须稳定(前端 composeSource 先 trimEnd,故不会逐次长出新行)。
#[test]
fn editing_a_note_keeps_md_tag_and_leaves_no_source_text() {
    let mut c = db();
    let id = seed_md_note(&mut c, "莽山栈道");
    let first = update(&mut c, id, &format!("莽山栈道\n#{MD_LEAF}")).unwrap().unwrap();
    assert_eq!(first.tags, vec![MD_LEAF.to_string()], "标签必须还在");
    assert_eq!(first.content, "莽山栈道\n", "正文不得残留 md 源码");
    assert_fts_matches_edges(&c);
    assert_no_orphan_tags(&c);

    let again = update(&mut c, id, &format!("{}\n#{MD_LEAF}", first.content.trim_end())).unwrap().unwrap();
    assert_eq!(again.content, first.content, "二次往返不得漂移");
    assert_eq!(again.tags, first.tags);
}

/// 勾选待办走同一条 update(use-note-actions 把"已勾选正文 + 原始路径"一起写回)
#[test]
fn toggling_a_todo_keeps_md_tag() {
    let mut c = db();
    let id = seed_md_note(&mut c, "- [ ] 买牛奶");
    let upd = update(&mut c, id, &format!("- [x] 买牛奶\n#{MD_LEAF}")).unwrap().unwrap();
    assert_eq!(upd.content, "- [x] 买牛奶\n");
    assert_eq!(upd.tags, vec![MD_LEAF.to_string()]);
}

/// 严格命中的普通标签与兜底命中的 md 标签在同一次保存里并存(严格侧行为一个字不变)
#[test]
fn strict_and_fallback_tags_coexist() {
    let mut c = db();
    let id = seed_md_note(&mut c, "莽山栈道");
    let upd = update(&mut c, id, &format!("莽山栈道 #普通\n#{MD_LEAF}")).unwrap().unwrap();
    assert_eq!(upd.content, "莽山栈道\n");
    assert!(upd.tags.contains(&"普通".to_string()));
    assert!(upd.tags.contains(&MD_LEAF.to_string()));
    assert_fts_matches_edges(&c);
}

/// 兜底不越界:标题 / C# / 行内代码里的 md 路径 / "# 后紧跟 md 符号(严格失败)" /
/// "前缀命中但库里没有更长的那条" 都不是标签,一个节点也不许建。
/// 注:`#不存在的路径` 这类**严格合法**的写法仍是标签(建节点)—— 那是既有语义,
/// 本次只约定"严格失败处的兜底不新建、不猜、不做部分剥离"。
#[test]
fn fallback_never_invents_or_partially_matches() {
    let mut c = db();
    seed_md_note(&mut c, "莽山栈道");
    let paths_before = paths(&c);
    let src = "# 标题\nC# 语法\n`#地点/中国大陆/湖南省/[郴](chēn)州市`\n\
               断在第 4 层 #[郴](chēn)州市\n\
               见 #地点/中国大陆/湖南省/[不存在的郴](chēn)州市 结束";
    // 走 create:新笔记不影响既有链接,标签表的任何变化都只可能来自兜底
    let n = create_plain(&mut c, src).unwrap();
    assert_eq!(n.content, src, "整段原样保留(不剥、不做部分剥离)");
    assert!(n.tags.is_empty(), "不得把不存在的路径当标签:{:?}", n.tags);
    assert_eq!(paths(&c), paths_before, "兜底一个节点也不许新建");
}
