/**
 * 引用优化 A + C 的写路径(仅 `--apply` 走这里):在单个事务里删直链 / 插关系边 /
 * 合并同名叶子 / 重算 `is_cited` / 重建 `entities_fts`;异常回滚后原样抛出。
 *
 * 由 `refs-optimize-ops.mjs` 调用(拆分以守 200 行);SQL 与预演脚本同源。
 * 调用方负责:先 `VACUUM INTO` 备份、`BEGIN` 之前的只读计划(`deleted` / `promoted` / `MERGES`)。
 */
export function applyWrites(db, { deleted, promoted, MERGES, ents, all, n1 }) {
  const leafName = (p) => p.split('/').pop();
  db.exec('BEGIN IMMEDIATE');
  try {
    const delStmt = db.prepare("DELETE FROM edges WHERE kind='link' AND source_id=?1 AND target_id=?2");
    for (const d of deleted.values()) delStmt.run(d.s, d.t);
    const insStmt = db.prepare("INSERT OR IGNORE INTO edges(source_id,target_id,kind,remark,created_at) VALUES(?1,?2,'link',?3,datetime('now','localtime'))");
    for (const p of promoted) insStmt.run(p.x, p.b, p.remark);
    const linkBeforeMerge = n1("edges WHERE kind='link'");
    const run = (sql, ...a) => db.prepare(sql).run(...a);
    for (const m of MERGES) {
      for (const src of m.sourceIds) {
        const srcPath = ents.get(src).path;
        const tgtPath = ents.get(m.targetId).path;
        const sub = all('WITH RECURSIVE d(id) AS (SELECT ?1 UNION SELECT e.id FROM entities e JOIN d ON e.parent_id = d.id) SELECT id FROM d', src);
        for (const r of sub) {
          run("UPDATE entities SET parent_id=(CASE WHEN id=?1 THEN ?2 ELSE parent_id END), path=replace(path, ?3, ?4), depth=depth+(?5) WHERE id=?1", r.id, m.targetId, `${srcPath}/`, `${tgtPath}/`, ents.get(m.targetId).depth - ents.get(src).depth);
        }
        run("INSERT INTO entity_merge_log(source_entity_id,target_entity_id,moved_child_ids,note_links,edges,meta_snapshot) SELECT ?1,?2,COALESCE((SELECT json_group_array(id) FROM entities WHERE parent_id=?1),'[]'),(SELECT COUNT(*) FROM edges WHERE kind='link' AND target_id=?1 AND source_id IN (SELECT id FROM entities WHERE path IS NULL)),(SELECT COUNT(*) FROM edges WHERE kind='link' AND (source_id=?1 OR target_id=?1)),meta FROM entities WHERE id=?1", src, m.targetId);
        run("UPDATE OR IGNORE edges SET target_id=?1 WHERE kind='link' AND target_id=?2 AND (SELECT path FROM entities WHERE id=edges.source_id) IS NULL", m.targetId, src);
        for (const r of all("SELECT target_id t, remark r FROM edges WHERE kind='link' AND source_id=?1 AND target_id IN (SELECT id FROM entities WHERE path IS NOT NULL)", src)) if (r.t !== m.targetId) insStmt.run(m.targetId, r.t, r.r);
        for (const r of all("SELECT source_id s, remark r FROM edges WHERE kind='link' AND target_id=?1 AND source_id IN (SELECT id FROM entities WHERE path IS NOT NULL)", src)) if (r.s !== m.targetId) insStmt.run(r.s, m.targetId, r.r);
        run("DELETE FROM edges WHERE kind='link' AND (source_id=?1 OR target_id=?1)", src);
        run("DELETE FROM edges WHERE kind='child' AND target_id=?1", src);
        // 旧名登记为别名:旧完整路径原样登记(与生产 merge_core 同:登记后才删源,不做路径冲突判定);
        // 旧叶子名仅在不与现有标签/他人别名冲突时登记
        run('INSERT INTO entity_aliases(alias,entity_id) VALUES(?1,?2) ON CONFLICT(alias) DO UPDATE SET entity_id=excluded.entity_id', srcPath, m.targetId);
        const leaf = leafName(srcPath);
        if (leaf !== srcPath && !all('SELECT 1 FROM entities WHERE path=?1', leaf).length && !all('SELECT 1 FROM entity_aliases WHERE alias=?1 AND entity_id<>?2', leaf, m.targetId).length) {
          run('INSERT OR IGNORE INTO entity_aliases(alias,entity_id) VALUES(?1,?2)', leaf, m.targetId);
        }
        run('DELETE FROM entities WHERE id=?1', src);
      }
    }
    run("UPDATE entities SET is_cited = EXISTS(SELECT 1 FROM edges x WHERE x.target_id=entities.id AND x.kind='link')");
    run('DELETE FROM entities_fts');
    run('INSERT INTO entities_fts(rowid,meta,paths) SELECT id,meta,paths FROM entities_fts_src');
    db.exec('COMMIT');
    return { a3RemovedLinks: linkBeforeMerge - n1("edges WHERE kind='link'") };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
