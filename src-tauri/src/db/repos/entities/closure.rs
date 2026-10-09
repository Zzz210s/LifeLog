//! 派生规则:树 / 图渲染集合的祖先闭包(spec §3.3)与 `is_cited` 增量维护(§3.1)。
//! 闭包只在这里实现一处,侧栏树与关系图共用;闭包**不改变** `is_cited` 列,只决定「渲染哪些节点」。
//! `is_cited` = 有入 `link` 边(`child` 是结构边,不算引用);029 的触发器也会维护它,
//! 这里的 [`sync_is_cited`] 是同一口径的写路径兜底(幂等)。
use rusqlite::{params, Connection};

/// 闭包 CTE:从 `is_cited=1` 沿 `child` 边反向(向上)走。
/// 中间层自动建树节点自身 `is_cited=0`,但作为被引用叶子的祖先必须进集合。
pub const CLOSURE_CTE: &str = "WITH RECURSIVE up(id) AS (
     SELECT id FROM entities WHERE is_cited = 1
     UNION
     SELECT e.source_id FROM edges e JOIN up ON e.target_id = up.id WHERE e.kind = 'child'
   )";

/// 树 / 图渲染集合,按 id 升序(`is_cited=1` ∪ 祖先)。
pub fn tree_closure_ids(conn: &Connection) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare(&format!("{CLOSURE_CTE} SELECT id FROM up ORDER BY id"))?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
}

/// 单实体闭包判定 SQL 片段(`alias` 是实体表别名),供筛选编译使用。
/// 判定取渲染闭包,**不是**裸 `is_cited` 列(spec §4.1 / §10-P2 的 1454 vs 1373 反例)。
pub fn in_tree_predicate(alias: &str) -> String {
    format!("{alias}.id IN ({CLOSURE_CTE} SELECT id FROM up)")
}

/// `is_cited` 增量维护:`link` 边插 / 删后调用(与 028 触发器同口径,幂等)。
pub(crate) fn sync_is_cited(conn: &Connection, entity_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE entities SET is_cited = EXISTS(
           SELECT 1 FROM edges x WHERE x.target_id = entities.id AND x.kind = 'link')
         WHERE id = ?1",
        params![entity_id],
    )?;
    Ok(())
}
