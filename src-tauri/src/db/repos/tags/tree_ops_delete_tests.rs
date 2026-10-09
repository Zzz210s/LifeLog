//! 自 tree_ops_tests.rs 摘出(守 200 行红线):本模块是它的子模块,
//! 故 `use super::*` 直接可见父的全部夹具与用例助手(夹具不重复定义)。
use super::*;

/// ⑥ 同级重名:改名/移动撞上兄弟改为**自动整棵并**(设计 2026-10-06 §6);非法名仍拒绝
#[test]
fn same_level_duplicate_merges() {
    let mut c = db();
    notes::create_plain(&mut c, "a #工作").unwrap();
    notes::create_plain(&mut c, "b #生活").unwrap();
    notes::create_plain(&mut c, "c #工作/项目A").unwrap();
    notes::create_plain(&mut c, "d #项目A").unwrap();
    let life = id_at(&c, "生活");
    let other = id_at(&c, "项目A");
    let work = id_at(&c, "工作");

    rename(&mut c, life, "工作").unwrap();
    move_to(&mut c, other, Some(work)).unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path='工作'"), 1, "根级只一个 工作");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path='工作/项目A'"), 1);
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND id={life}")), 0, "生活 并入 工作");
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND id={other}")), 0, "项目A 并入 工作/项目A");
    assert!(rename(&mut c, work, "工作 计划").is_err(), "非法的标签名一律拒绝");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path='工作'"), 1);
    // 撞名改走合并后,库内不变量必须依然成立
    assert_fts_matches_edges(&c);
    assert_no_orphan_tags(&c);
}

/// ⑦ 删除子树:父与子一并删除、链接解除、笔记保留、FTS 不再含该路径
#[test]
fn delete_subtree_removes_tags_keeps_notes() {
    let mut c = db();
    notes::create_plain(&mut c, "纪要 #工作/项目A").unwrap();
    let root = id_at(&c, "工作");

    assert_eq!(impact(&c, root).unwrap(), (1, 1));
    assert_eq!(impact(&c, id_at(&c, "工作/项目A")).unwrap(), (0, 1));

    delete_subtree(&mut c, root).unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL"), 0);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM edges e JOIN entities s ON s.id = e.source_id JOIN entities t ON t.id = e.target_id WHERE e.kind = 'link' AND (s.path IS NOT NULL OR t.path IS NOT NULL)"), 0);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NULL"), 1);
    assert_eq!(hits(&c, "项目A"), 0);
    assert_eq!(hits(&c, "纪要"), 1);
    // 删除不改写 filter_current(S7),故只断言 FTS 与孤儿两项
    assert_fts_matches_edges(&c);
    assert_no_orphan_tags(&c);
}

/// ⑩ 删除不存在的标签:报错且整事务回滚(空操作不落库)
#[test]
fn delete_missing_tag_rolls_back() {
    let mut c = db();
    notes::create_plain(&mut c, "x #工作/项目A").unwrap();
    let before = dump(&c);
    assert!(delete_subtree(&mut c, 9999).is_err());
    assert_eq!(dump(&c), before);
    assert_eq!(
        count(
            &c,
            "SELECT COUNT(*) FROM edges e JOIN entities s ON s.id = e.source_id JOIN entities t ON t.id = e.target_id WHERE e.kind = 'link' AND s.path IS NULL AND t.path IS NOT NULL AND e.target_id = (SELECT id FROM entities WHERE path IS NOT NULL AND path='工作/项目A')"
        ),
        1,
        "笔记 -> 叶子标签的那条链接仍在"
    );
    assert_fts_matches_edges(&c);
    assert_no_orphan_tags(&c);
}
