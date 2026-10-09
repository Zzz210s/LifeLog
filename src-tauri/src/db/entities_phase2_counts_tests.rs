//! 阶段 2 的老表计数读数(自 entities_phase2_tests.rs 拆出以守 200 行):
//! 025 前后老表行数逐值相同(旧表仍真源),新表边数符合预期(未解析 link 不落边)。
//! 夹具停在 v26:028 会把老表下架并重发 id,老表计数只能在 v26 比。
use super::entities_tags_fixture::{add_tag, count, migrate_to_v23, seed_notes, seed_v23};
use super::*;

/// ⑧ 老表计数不变:025 前后老表行数逐值相同,新表计数符合预期。
#[test]
fn legacy_counts_unchanged_by_phase2() {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v23(&c);
    seed_v23(&c);
    seed_notes(&c);
    add_tag(&c, 4, "空壳", Some(1), "地点轴/空壳", 2);
    add_tag(&c, 5, "孤立根", None, "孤立根", 1);
    let snap = |c: &Connection| {
        (
            count(c, "SELECT COUNT(*) FROM notes"),
            count(c, "SELECT COUNT(*) FROM tags"),
            count(c, "SELECT COUNT(*) FROM tag_links"),
            count(c, "SELECT COUNT(*) FROM note_links"),
        )
    };
    let before = snap(&c);
    assert_eq!(before, (2, 5, 4, 2), "夹具基数(旧表:note_links 含 1 条未解析行)");
    apply(&c, MIGRATIONS[23], 24).unwrap();
    apply(&c, MIGRATIONS[24], 25).unwrap();
    apply(&c, MIGRATIONS[25], 26).unwrap();
    assert_eq!(snap(&c), (2, 5, 4, 2), "024/025/026 不得改写老表行数");
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM edges WHERE kind='link'"),
        1,
        "未解析的 note_links 行不落 link 边"
    );
    assert_eq!(count(&c, "SELECT COUNT(*) FROM entities"), 7, "5 标签 + 2 笔记");
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM edges"),
        8,
        "child 3 + tagging 3 + relation 1 + link 1"
    );
}
