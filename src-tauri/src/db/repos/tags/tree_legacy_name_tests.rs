//! 标签树仓库层的 C-2 兼容测试(自 tags_tree_tests.rs 拆出:原文件 211 行超出 200 行上限)。
//! 覆盖"存量名含 / 的平铺标签(name == path)与新路径空间撞车时必须显式和解"的直调与端到端两条路径。
use super::*;

/// C-2(直调):库里已有 待定/TBD 根标签时,ensure_path 必须就地和解成两级树
#[test]
fn ensure_path_reconciles_legacy_flat_name_with_slash() {
    let c = db();
    // 006 迁移把存量标签原样保留为根:name == path == '待定/TBD',depth=1,parent=NULL
    let legacy = ensure_path(&c, &segs(&["待定/TBD"])).unwrap();

    let leaf = ensure_path(&c, &segs(&["待定", "TBD"])).unwrap();

    // 复用旧行 id(其链接不丢),身份规整为第二级;而不是静默复用根身份或报错
    assert_eq!(leaf, legacy);
    let root = id_at(&c, "待定");
    assert_ne!(root, legacy);
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND id=(SELECT id FROM entities WHERE path IS NOT NULL AND path='待定/TBD') AND entity_name(meta)='TBD' AND depth=2 AND parent_id=(SELECT id FROM entities WHERE path IS NOT NULL AND path='待定')"),
        1
    );
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND path='待定' AND entity_name(meta)='待定' AND depth=1 AND parent_id IS NULL"), 1);
    // 幂等:再调一次不再变化
    let before = dump(&c);
    assert_eq!(ensure_path(&c, &segs(&["待定", "TBD"])).unwrap(), leaf);
    assert_eq!(dump(&c), before);
}

/// C-2(端到端):保存 #待定/TBD 时不得静默复用旧根行,结果必须是两级树且链接在末端
#[test]
fn create_with_legacy_flat_name_builds_two_level_tree() {
    let mut c = db();
    ensure_path(&c, &segs(&["待定/TBD"])).unwrap();
    let n = notes::create_plain(&mut c, "记一笔 #待定/TBD").unwrap();
    assert_eq!(n.tags, vec!["待定/TBD"]);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL"), 2);
    let leaf = id_at(&c, "待定/TBD");
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM entities WHERE path IS NOT NULL AND parent_id={leaf}")), 0);
    assert_eq!(
        count(&c, &format!("SELECT COUNT(*) FROM edges e JOIN entities s ON s.id = e.source_id JOIN entities t ON t.id = e.target_id WHERE e.kind = 'link' AND s.path IS NULL AND t.path IS NOT NULL AND e.target_id={leaf} AND e.source_id={}", n.id)),
        1
    );
    assert_eq!(count(&c, &format!("SELECT COUNT(*) FROM edges e JOIN entities s ON s.id = e.source_id JOIN entities t ON t.id = e.target_id WHERE e.kind = 'link' AND (s.path IS NOT NULL OR t.path IS NOT NULL) AND (CASE WHEN s.path IS NOT NULL THEN e.source_id ELSE e.target_id END)={}", id_at(&c, "待定"))), 0);
    assert_eq!(hits(&c, "待定/TBD"), 1);
}

/// 孤儿回收收窄:有子节点的父节点不得回收;整条无用链(叶->父)逐层回收
#[test]
fn gc_orphans_keeps_parents_with_children_and_prunes_dead_chain() {
    let mut c = db();
    ensure_path(&c, &segs(&["a", "b"])).unwrap();
    let n = notes::create_plain(&mut c, "x #a/b").unwrap();
    assert_eq!(id_at(&c, "a/b"), ensure_path(&c, &segs(&["a", "b"])).unwrap());

    gc_orphans(&c).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL"), 2, "父节点有子节点,不是孤儿");

    // 解链后叶与父逐层收敛回收
    c.execute(
        "DELETE FROM edges WHERE kind='link' AND source_id=?1",
        [n.id],
    )
    .unwrap();
    gc_orphans(&c).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities WHERE path IS NOT NULL"), 0);
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM entities WHERE path IS NOT NULL AND path=?1", [path], |r| r.get(0))
        .unwrap()
}
