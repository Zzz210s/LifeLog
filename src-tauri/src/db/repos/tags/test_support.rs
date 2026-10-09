//! 【统一实体测试夹具·仅测试】统一元数据(v28)后,`query` 的域变成全部实体
//! (spec §4.1:清空筛选即显示标签)。迁移 028 预置的默认筛选
//! `treeMembership=out OR singleLine=multi` 等价于旧的「全部笔记」,但仓库层的
//! `query` / `count_matching` / `group_skeleton` / `group_page` 只认调用方给的条件,
//! 所以老用例在**测试侧**把这条默认筛选追加进去(见 [`with_note_domain`]),
//! 结果集收窄用 [`is_note`](树外实体 = `path IS NULL`)。
//!
//! 直接对 `entities`/`edges` 写 SQL 的用例不需要本模块:树内实体 = `path IS NOT NULL`,
//! 树外实体(笔记)= `path IS NULL`,正文/名字 = `meta`,引用边一律 `edges.kind = 'link'`。
use crate::db::repos::notes::notes_filter::FilterConditions;
use crate::db::repos::notes::notes_filter_groups::{FilterGroup, GroupItem};
use rusqlite::Connection;

/// 老用例口径的「笔记域」:统一元数据后 `query` 的域是全实体(spec §4.1:清空筛选即显示标签),
/// 这些用例关心的是迁移前的「全部笔记」,故在测试侧把**迁移 028 预置的默认筛选**
/// (`treeMembership=out OR singleLine=multi`,等价于旧 `kind='note'`)追加进条件,
/// 让按条件过滤的入口(query / count_matching / skeleton / 分组)口径与旧断言一致。
pub(crate) fn note_domain_items() -> Vec<GroupItem> {
    vec![
        GroupItem::TreeMembership { value: "out".into() },
        GroupItem::SingleLine { value: "multi".into() },
    ]
}

/// 给条件追加默认筛选组(op='or');组间关系不变(`group_op` 默认 and)。
pub(crate) fn with_note_domain(mut c: FilterConditions) -> FilterConditions {
    c.groups.push(FilterGroup { op: "or".to_string(), items: note_domain_items() });
    c
}

/// 老用例口径的「笔记域」:统一元数据后 `query` 的域是全实体(spec §4.1),
/// 这些用例关心的是树外实体(老 `kind='note'`),在测试侧就地收窄。
pub(crate) fn is_note(conn: &Connection, id: i64) -> bool {
    conn.query_row("SELECT path IS NULL FROM entities WHERE id = ?1", [id], |r| r.get(0))
        .unwrap_or(false)
}
