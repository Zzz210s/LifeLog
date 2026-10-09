//! 阶段 2(024/025/026)用例共用夹具:跑到 v26 的库 + 实体/边读数小工具。
//! 断言里出现的老表(`tags`/`tag_links`)与偏移 id 都只在 v26 成立 —— 028 会重发全库 id
//! 并把老链接表下架,故这个夹具刻意停在 v26。
use super::entities_tags_fixture::{add_tag, migrate_to_v23, seed_notes, seed_v23};
use super::*;
use crate::db::repos::entities::TAG_ID_OFFSET;

/// `seed_v23` + `seed_notes`,再补两个空壳:4「空壳」挂 1 下(有父、无链接、无子)、
/// 5「孤立根」(无父无链接无子)。老 `gc_orphans` 要回收「有父但无链接无子」,新口径必须同样回收。
pub(crate) fn seeded_v26() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate_to_v23(&c);
    seed_v23(&c);
    seed_notes(&c);
    add_tag(&c, 4, "空壳", Some(1), "地点轴/空壳", 2);
    add_tag(&c, 5, "孤立根", None, "孤立根", 1);
    apply(&c, MIGRATIONS[23], 24).unwrap();
    apply(&c, MIGRATIONS[24], 25).unwrap();
    apply(&c, MIGRATIONS[25], 26).unwrap();
    c
}

/// 老标签 id -> 实体 id(024/025 的偏移),只对 v26 成立。
pub(crate) fn tag(id: i64) -> i64 {
    id + TAG_ID_OFFSET
}

pub(crate) fn ids(c: &Connection, sql: &str) -> Vec<i64> {
    let mut s = c.prepare(sql).unwrap();
    s.query_map([], |r| r.get::<_, i64>(0)).unwrap().map(|x| x.unwrap()).collect()
}

/// 边摘要(两端 | kind | remark),排序确定:删除前后比较「其余行不动」。
pub(crate) fn edge_dump(c: &Connection) -> Vec<String> {
    let mut s = c
        .prepare(
            "SELECT source_id||'|'||target_id||'|'||kind||'|'||remark FROM edges \
             ORDER BY source_id, target_id, kind",
        )
        .unwrap();
    s.query_map([], |r| r.get::<_, String>(0)).unwrap().map(|x| x.unwrap()).collect()
}

/// 今天 `gc_orphans` 的三条件(无出 `tag_links`、非关系目标、无子节点)。
pub(crate) const OLD_ORPHANS: &str = "SELECT id FROM tags WHERE \
  NOT EXISTS (SELECT 1 FROM tag_links l WHERE l.tag_id = tags.id) \
  AND NOT EXISTS (SELECT 1 FROM tag_links c WHERE c.target_type IN ('tag','type') AND c.target_id = tags.id) \
  AND NOT EXISTS (SELECT 1 FROM tags ch WHERE ch.parent_id = tags.id)";

/// 边表口径:无出边 + 无入边。**父子入边(有父)不算「入边」** —— 否则「有父但无链接无子」的空壳
/// 会被留下,与 `tree_legacy_name_tests::gc_orphans_keeps_parents_with_children_and_prunes_dead_chain`
/// 的「整条无用链逐层回收」冲突;旧口径唯一被排除的正是这条父指针。
pub(crate) const NEW_ORPHANS: &str = "SELECT e.id - 1000000000 FROM entities e WHERE e.kind='tag' \
  AND NOT EXISTS (SELECT 1 FROM edges g WHERE g.source_id = e.id) \
  AND NOT EXISTS (SELECT 1 FROM edges g WHERE g.target_id = e.id AND g.kind <> 'child')";
