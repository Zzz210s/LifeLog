//! 阶段 1「新表投影 == 老表」的逐值对账(spec §6.5 共存策略):`entities`/`edges`
//! 与老 `tags`/`tag_links` 双向比对。五条 spec §3 对账在 `reconcile.rs`,这里是它之外
//! 的镜像等价读数,只在老表仍存在的阶段(1–3)可跑。
use super::reconcile::run_check;
use rusqlite::Connection;

/// ① `entities(kind='tag')` ↔ `tags` 逐值(id 偏移 + name/parent_id/path/depth/sort_order),
/// 双向:老表每一行都要有对应新行且逐值相等,新行也要能追回唯一老行。
pub const TAGS_MIRROR: &str = "\
SELECT 'tags->entities', t.id FROM tags t
LEFT JOIN entities e ON e.kind = 'tag' AND e.legacy_id = t.id
WHERE e.id IS NULL OR e.id <> t.id + 1000000000 OR e.name IS NOT t.name
   OR e.parent_id IS NOT t.parent_id + 1000000000 OR e.path IS NOT t.path
   OR e.depth IS NOT t.depth OR e.sort_order IS NOT t.sort_order
UNION ALL
SELECT 'entities->tags', e.id FROM entities e
LEFT JOIN tags t ON t.id = e.legacy_id
WHERE e.kind = 'tag' AND (t.id IS NULL OR e.id <> t.id + 1000000000)";

/// ② `child` 边 ↔ `tags.parent_id` 双向(根标签须无边,非根标签须有且仅对一条边)。
pub const CHILD_MIRROR: &str = "\
SELECT 'tags->child', t.id FROM tags t
LEFT JOIN edges c ON c.kind = 'child' AND c.target_id = t.id + 1000000000
WHERE t.parent_id IS NOT NULL
  AND (c.id IS NULL OR c.source_id <> t.parent_id + 1000000000)
UNION ALL
SELECT 'child->tags', c.id FROM edges c
LEFT JOIN tags t ON t.id = c.target_id - 1000000000
WHERE c.kind = 'child' AND (t.id IS NULL OR c.source_id IS NOT t.parent_id + 1000000000)";

/// ③ `relation` 边 ↔ `tag_links` 的 tag/type 型行逐值(两端 + 属性名 `remark`)。
/// 迁移只搬「两端标签都存在」的行(悬挂行跳过),故老表方向加两端 EXISTS 守。
pub const RELATION_MIRROR: &str = "\
SELECT 'tag_links->edges', l.tag_id, l.target_id FROM tag_links l
LEFT JOIN edges e ON e.kind = 'relation'
  AND e.source_id = l.tag_id + 1000000000 AND e.target_id = l.target_id + 1000000000
WHERE l.target_type IN ('tag', 'type')
  AND EXISTS (SELECT 1 FROM tags s WHERE s.id = l.tag_id)
  AND EXISTS (SELECT 1 FROM tags d WHERE d.id = l.target_id)
  AND (e.id IS NULL OR e.remark IS NOT COALESCE(l.remark, ''))
UNION ALL
SELECT 'edges->tag_links', e.source_id - 1000000000, e.target_id - 1000000000 FROM edges e
WHERE e.kind = 'relation'
  AND NOT EXISTS (
    SELECT 1 FROM tag_links l
    WHERE l.target_type IN ('tag', 'type')
      AND l.tag_id = e.source_id - 1000000000
      AND l.target_id = e.target_id - 1000000000
      AND COALESCE(l.remark, '') = e.remark)";

/// ④ `edges` 无悬挂引用:每条边的两端都必须是存在的实体(不只 `child`,覆盖全 kind)。
pub const DANGLING_EDGES: &str = "\
SELECT 'dangling', e.id, e.kind FROM edges e
WHERE NOT EXISTS (SELECT 1 FROM entities s WHERE s.id = e.source_id)
   OR NOT EXISTS (SELECT 1 FROM entities d WHERE d.id = e.target_id)";

/// 跑三组双向镜像比对 + 全 kind 悬挂检查;任一命中即带标题与命中行 panic。
pub fn assert_mirror_matches_legacy(conn: &Connection) {
    let checks: [(&str, &str); 4] = [
        ("1 entities↔tags 逐值", TAGS_MIRROR),
        ("2 child 边↔tags.parent_id", CHILD_MIRROR),
        ("3 relation 边↔tag_links(tag 型) 逐值", RELATION_MIRROR),
        ("4 edges 无悬挂引用", DANGLING_EDGES),
    ];
    for (label, sql) in checks {
        let rows = run_check(conn, sql).unwrap_or_else(|e| panic!("镜像对账 {label} 执行失败: {e}"));
        assert!(rows.is_empty(), "镜像对账 {label} 命中 {} 行: {rows:?}", rows.len());
    }
}
