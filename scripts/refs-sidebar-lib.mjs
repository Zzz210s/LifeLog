/**
 * 侧栏标签计数的只读复刻(照 `src-tauri/src/db/repos/tags/query.rs::counts`)。
 *
 * 口径(与标签筛选一致,**去重对象是引用源**而不是笔记,028 起 tag→tag 边也计入):
 *  - `self_count`  = `COUNT(DISTINCT source_id)`,指向该标签的 `link` 边;
 *  - `subtree_count`(含子级 / roll)= 对子树内任意 `link` 目标做 `COUNT(DISTINCT source_id)`。
 * 这两列是「本级 / 含子级」前后对照的真源 —— 只数笔记会把 tag→tag 关系边漏掉。
 */
export function sidebarCounts(db) {
  return db
    .prepare(
      `WITH RECURSIVE sub(root, leaf) AS (
         SELECT id, id FROM entities WHERE path IS NOT NULL
         UNION ALL SELECT s.root, t.id FROM entities t JOIN sub s ON t.parent_id = s.leaf
           WHERE t.path IS NOT NULL
       ),
       own AS (SELECT target_id AS tag_id, COUNT(DISTINCT source_id) AS n FROM edges
               WHERE kind = 'link' GROUP BY target_id),
       roll AS (SELECT sub.root AS root, COUNT(DISTINCT l.source_id) AS n
                FROM sub JOIN edges l ON l.target_id = sub.leaf AND l.kind = 'link'
                GROUP BY sub.root)
       SELECT t.id, t.path, t.depth, t.sort_order, COALESCE(own.n, 0) AS self_count, COALESCE(roll.n, 0) AS subtree_count
       FROM entities t
       LEFT JOIN own ON own.tag_id = t.id
       LEFT JOIN roll ON roll.root = t.id
       WHERE t.path IS NOT NULL
       ORDER BY t.path`,
    )
    .all();
}
