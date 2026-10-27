//! 派生规则:树 / 图渲染集合的祖先闭包(spec §3.3 / §5.4-①)与 `is_cited` 增量维护(§3.1)。
//! 闭包只在这里实现一处,侧栏树与关系图共用;闭包**不改变** `is_cited` 列,只决定「渲染哪些节点」。
//! v31:`is_cited` = 有入**非子级线**(`name_id IS NULL OR name_id <> 0`);子级线(`name_id = 0`)是结构边,
//! 不算引用。031 的触发器也会维护它,这里的 [`sync_is_cited`] 是同一口径的写路径兜底(幂等)。
use rusqlite::{params, Connection};

/// 闭包 CTE:从 `is_cited=1` 沿**入子级线**(`name_id = 0`,保留点 `子级`)反向(向上)走。
/// 中间层自动建树节点自身 `is_cited=0`,但作为被引用叶子的祖先必须进集合。
/// v31 口径:树的父子关系 = `lines(name_id = 0)` 的 to -> from;`idx_lines_to(to_id, name_id)` 供上溯。
pub const CLOSURE_CTE: &str = "WITH RECURSIVE up(id) AS (
     SELECT id FROM points WHERE is_cited = 1
     UNION
     SELECT l.from_id FROM lines l JOIN up ON l.to_id = up.id WHERE l.name_id = 0
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

/// `is_cited` 增量维护:**入非子级线**(`name_id IS NULL OR name_id <> 0`)插 / 删后调用
/// (与 031 触发器同口径,幂等);子级线是结构边,不动 `is_cited`。
pub(crate) fn sync_is_cited(conn: &Connection, entity_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE points SET is_cited = EXISTS(
           SELECT 1 FROM non_tree_lines x WHERE x.to_id = points.id)
         WHERE id = ?1",
        params![entity_id],
    )?;
    Ok(())
}
