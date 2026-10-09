//! 自 notes_update_tests.rs 摘出(守 200 行红线):本模块是它的子模块,
//! 故 `use super::*` 直接可见父的全部夹具与用例助手(夹具不重复定义)。
use super::*;

#[test]
fn update_missing_id_writes_no_links() {
    let mut c = db();
    create_plain(&mut c, "甲").unwrap();
    assert!(update(&mut c, 9999, "正文 [[甲]]").unwrap().is_none());
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges WHERE kind='link'", &[]), 0, "回滚的 tx 不留下链接边");
}

#[test]
fn tag_shaped_link_title_produces_no_link() {
    let mut c = db();
    let src = create_plain(&mut c, "源").unwrap();
    update(&mut c, src.id, "参考 [[#甲]]").unwrap().unwrap();
    // 扫的是剥标签后的正文:此处已是 `参考 [[]]`,不产生链接(设计 §5 边界 5);
    // 而 `#甲` 仍是普通标签(标签语法只认 `#`,与链接互不干扰)
    assert_eq!(
        count(
            &c,
            "SELECT COUNT(*) FROM edges WHERE kind='link'
               AND target_id IN (SELECT id FROM entities WHERE path IS NULL)",
            &[]
        ),
        0,
        "不产生笔记间链接(指向标签的 link 边是 #甲 自己)"
    );
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE name='甲'", &[]), 1);
}
