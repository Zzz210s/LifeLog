//! 迁移 024 的边专项读数:`edges(kind='relation')` 从 `tag_links` 的 `tag`/`type` 行搬入,
//! 属性名(`remark`,迁移 023 口径)跟着边;两端按标签 id 偏移;悬挂引用不中断迁移。
//! 断言只对 024 本体成立(028 会重发 id)、故把库停在 v24。
use super::entities_tags_fixture::{add_tag, count, migrate_to_v23, seed_v23};
use super::*;
use crate::db::repos::entities::TAG_ID_OFFSET;

/// ① relation 边带属性名:24 条边逐条搬入 remark,两端按偏移换算
#[test]
fn relation_edges_carry_remark() {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v23(&c);
    seed_v23(&c);
    add_tag(&c, 10, "作者轴", None, "作者轴", 1);
    for i in 0..23 {
        let id = 100 + i;
        add_tag(&c, id, &format!("人员{id}"), None, &format!("人员{id}"), 1);
        c.execute(
            "INSERT INTO tag_links(tag_id,target_type,target_id,remark) VALUES(?1,'tag',10,?2)",
            rusqlite::params![id, format!("属性{id}")],
        )
        .unwrap();
    }
    apply(&c, MIGRATIONS[23], 24).unwrap();

    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM edges WHERE kind='relation'"),
        24
    );
    assert_eq!(
        count(
            &c,
            "SELECT COUNT(*) FROM edges WHERE kind='relation' AND remark<>''"
        ),
        24,
        "属性名必须搬到边上(记忆 #1265:属性名属于边,不属于标签)"
    );
    let (src, tgt, remark): (i64, i64, String) = c
        .query_row(
            "SELECT source_id, target_id, remark FROM edges WHERE kind='relation' AND source_id=?1",
            [100 + TAG_ID_OFFSET],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!((src, tgt), (100 + TAG_ID_OFFSET, 10 + TAG_ID_OFFSET));
    assert_eq!(remark, "属性100");
}

/// ② 悬挂引用(历史重放里指向已删标签的行)跳过,不因外键中断整个迁移
#[test]
fn relation_edge_skips_dangling_target() {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v23(&c);
    seed_v23(&c);
    c.execute(
        "INSERT INTO tag_links(tag_id,target_type,target_id,remark) VALUES(3,'tag',999,'幽灵')",
        [],
    )
    .unwrap();

    apply(&c, MIGRATIONS[23], 24).unwrap();

    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM edges WHERE kind='relation'"),
        1,
        "只有两端都存在标签实体的行才落边"
    );
}
