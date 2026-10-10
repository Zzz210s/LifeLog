/**
 * 关系图载荷的只读复刻(照 `db/repos/graph.rs` 的四段 SQL + `commands/graph.rs` 的 DTO 组装)。
 * 目的:在不起应用、不跑 cargo 的前提下,给 `graph_data` 的规模读数(节点 / 树边 / 共现边 /
 * 链接边 / 序列化字节数),与 `graph_calibration_tests::graph_threshold_readout` 同口径。
 *
 * 口径要点:
 *  - 节点 = 渲染闭包(`is_cited=1 AND path IS NOT NULL` ∪ 祖先),不是裸 `is_cited`;
 *  - 枢纽阈值 `HUB_THRESHOLD=60`(commands/graph.rs T4.2 标定),两端都不参与共现边;
 *  - 共现边 = 同一 `link` 源上共同出现的标签对;链接边 = `note_links::all_resolved`(笔记间);
 *  - 字节数 = `JSON.stringify` 后的 UTF-8 字节数(serde 紧凑 JSON,字段名按 DTO 的 camelCase)。
 */
export const HUB_THRESHOLD = 60;

export function graphReadout(db) {
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const nodes = all(`WITH RECURSIVE up(id) AS (
      SELECT id FROM entities WHERE is_cited = 1 AND path IS NOT NULL
      UNION SELECT e.source_id FROM edges e JOIN up ON e.target_id = up.id WHERE e.kind = 'child'
    ),
    sub(root, leaf) AS (
      SELECT id, id FROM up
      UNION ALL SELECT s.root, e.id FROM entities e JOIN sub s ON e.parent_id = s.leaf
    ),
    roll AS (SELECT sub.root AS root, COUNT(DISTINCT l.source_id) AS n
             FROM sub JOIN edges l ON l.target_id = sub.leaf AND l.kind = 'link' GROUP BY sub.root),
    selfc AS (SELECT target_id AS id, COUNT(DISTINCT source_id) AS n
              FROM edges WHERE kind = 'link' GROUP BY target_id)
    SELECT t.id, t.path, t.depth, t.parent_id AS parent, COALESCE(roll.n, 0) AS notes,
           COALESCE(selfc.n, 0) AS self_count, t.sort_order
    FROM up JOIN entities t ON t.id = up.id
    LEFT JOIN roll ON roll.root = t.id LEFT JOIN selfc ON selfc.id = t.id ORDER BY t.path`);
  const hubs = all(`SELECT target_id FROM edges WHERE kind = 'link'
    GROUP BY target_id HAVING COUNT(DISTINCT source_id) > ?`, HUB_THRESHOLD);
  const co = all(`WITH hub AS (SELECT target_id FROM edges WHERE kind = 'link'
      GROUP BY target_id HAVING COUNT(DISTINCT source_id) > ?1)
    SELECT a.target_id AS a, b.target_id AS b, COUNT(*) AS w
    FROM edges a JOIN edges b ON a.source_id = b.source_id AND a.target_id < b.target_id
    WHERE a.kind = 'link' AND b.kind = 'link'
      AND a.target_id NOT IN (SELECT target_id FROM hub)
      AND b.target_id NOT IN (SELECT target_id FROM hub)
    GROUP BY a.target_id, b.target_id ORDER BY a.target_id, b.target_id`, HUB_THRESHOLD);
  const tree = all("SELECT source_id AS a, target_id AS b FROM edges WHERE kind = 'child' ORDER BY target_id");
  const links = all(`SELECT e.source_id AS a, e.target_id AS b FROM edges e
    WHERE e.kind = 'link' AND e.source_id <> e.target_id
      AND EXISTS(SELECT 1 FROM entities s WHERE s.id = e.source_id AND s.path IS NULL)
      AND EXISTS(SELECT 1 FROM entities t WHERE t.id = e.target_id AND t.path IS NULL)
    ORDER BY e.id`);
  // DTO 形态照 commands/graph.rs:GraphNodeDto(camelCase) + GraphEdgeDto + GraphData{nodes,edges}
  const payload = {
    nodes: nodes.map((n) => ({ id: n.id, path: n.path, depth: n.depth, parent: n.parent, notes: n.notes, selfCount: n.self_count, sortOrder: n.sort_order })),
    edges: [
      ...tree.map((e) => ({ a: e.a, b: e.b, kind: 'tree', weight: 1 })),
      ...co.map((e) => ({ a: e.a, b: e.b, kind: 'co', weight: e.w })),
      ...links.map((e) => ({ a: e.a, b: e.b, kind: 'link', weight: 1 })),
    ],
  };
  return {
    hubThreshold: HUB_THRESHOLD,
    hubCount: hubs.length,
    nodeCount: nodes.length,
    treeEdgeCount: tree.length,
    coEdgeCount: co.length,
    linkEdgeCount: links.length,
    edgeCount: payload.edges.length,
    payloadBytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
    payloadKb: Math.round((Buffer.byteLength(JSON.stringify(payload), 'utf8') / 1024) * 10) / 10,
  };
}
