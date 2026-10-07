//! 分组 / 续页查询(自 `notes_group.rs` 拆出,守 200 行):每组首屏与组内 offset 续页。
//! 两者与平铺 `notes_query::query` 共用 `notes_page` 的排序/取数件与同一份 `where_clause`。
use super::notes_filter::{where_clause, FilterConditions, GroupByCond};
use super::notes_group::{fold_grouped_rows, attach_all, GroupPage, GroupRow, PER_GROUP};
use super::notes_group_key::group_key_cte;
use super::notes_page::{self, PAGE_SIZE};
use super::notes_sort::effective_sorts;
use super::tag_order;
use super::Note;
use rusqlite::{params_from_iter, types::Value, Connection};

/// 分组查询的 CTE 列表:`ord` + 排序轴 CTE + `grp`(**文本顺序即参数顺序**:
/// `build_order` 已先压入轴参数,故 `grp` 必须排在轴 CTE 之后)
fn ctes_with_group(
    order_ctes: Vec<String>,
    group_by: &GroupByCond,
    args: &mut Vec<Value>,
) -> Vec<String> {
    let mut ctes = vec![tag_order::ORD_BODY.to_string()];
    ctes.extend(order_ctes);
    ctes.push(group_key_cte(&group_by.path, args));
    ctes
}

/// 每组首屏:窗口函数 `ROW_NUMBER() OVER (PARTITION BY 组键 ORDER BY <sorts>)` 一次取全所有组
/// 的前 [`PER_GROUP`] 条。组内排序走 T1 的 `sorts`,组间按树序(哨兵组最后)。
pub fn query_grouped(
    conn: &Connection,
    conditions: &FilterConditions,
    group_by: &GroupByCond,
) -> Result<Vec<GroupPage>, String> {
    let mut args: Vec<Value> = Vec::new();
    let order = notes_page::build_order(&effective_sorts(conditions), &mut args);
    let ctes = ctes_with_group(order.ctes, group_by, &mut args);
    let (frag, where_args) = where_clause(conditions)?;
    args.extend(where_args);
    let page_body = format!(
        "page AS (
           SELECT n.id AS id, g.key AS gk, g.gok AS gg,
                  ROW_NUMBER() OVER (PARTITION BY g.key ORDER BY {}) AS rn
           FROM entities n
           LEFT JOIN grp g ON g.note_id = n.id{}
           WHERE n.kind='note' AND {frag}
         )",
        order.inner, order.joins
    );
    let mut all = ctes.clone();
    all.push(page_body);
    let tail = format!(
        "SELECT p.gk, n.id, n.content, n.created_at, t.path
         FROM page p
         JOIN entities n ON n.id = p.id
         LEFT JOIN edges l ON l.kind = 'tagging' AND l.source_id = n.id
         LEFT JOIN entities t ON t.id = l.target_id
         WHERE p.rn <= {PER_GROUP}
         ORDER BY (p.gk IS NULL), p.gg, p.gk, p.rn, t.path"
    );
    let sql = notes_page::with_ctes(&all, &tail);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(args), |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
            ) as GroupRow)
        })
        .map_err(|e| e.to_string())?;
    let mut flat = fold_grouped_rows(rows).map_err(|e| e.to_string())?;
    attach_all(conn, &mut flat)?;
    let mut pages: Vec<GroupPage> = Vec::new();
    for (key, note) in flat {
        match pages.last_mut() {
            Some(p) if p.key == key => p.notes.push(note),
            _ => pages.push(GroupPage { key, notes: vec![note] }),
        }
    }
    Ok(pages)
}

/// 某组续页:组内 offset(沿用今天的 `LIMIT PAGE_SIZE OFFSET ?`);`key = None` 取哨兵组。
/// 组内 offset 与别的组无关 —— 折叠/展开任何组都不会让另一组的续页错位。
pub fn query_group_page(
    conn: &Connection,
    conditions: &FilterConditions,
    group_by: &GroupByCond,
    key: Option<&str>,
    offset: i64,
) -> Result<Vec<Note>, String> {
    let mut args: Vec<Value> = Vec::new();
    let order = notes_page::build_order(&effective_sorts(conditions), &mut args);
    let ctes = ctes_with_group(order.ctes, group_by, &mut args);
    let (frag, where_args) = where_clause(conditions)?;
    args.extend(where_args);
    let group_pred = match key {
        Some(k) => {
            args.push(Value::Text(k.to_string()));
            "g.key = ?"
        }
        None => "g.key IS NULL",
    };
    args.push(Value::Integer(offset.max(0)));
    let page_body = format!(
        "page AS (
           SELECT n.id AS id{}
           FROM entities n
           LEFT JOIN grp g ON g.note_id = n.id{}
           WHERE n.kind='note' AND {frag} AND {group_pred}
           ORDER BY {}
           LIMIT {PAGE_SIZE} OFFSET ?
         )",
        order.page_cols, order.joins, order.inner
    );
    notes_page::run_page(conn, &ctes, &page_body, &order.outer, args)
}

#[cfg(test)]
#[path = "notes_group_page_tests.rs"]
mod notes_group_page_tests;
