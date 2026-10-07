use rusqlite::{params, Connection};
use serde::Serialize;

/// 笔记(流查询与单条读回的统一结构)。
/// `created_at` 是物理列:排序(D1 改按 id,与它同序)与筛选都不再用它,只作展示与导出。
/// `links` 是正文里的出链(L2 渲染 chip 用):单条读取与分页查询都会带上,
/// 未解析的链接也保留一行(`target_id`/`title` 为 None),前端据此画未解析样式。
#[derive(Serialize, Debug)]
pub struct Note {
    pub id: i64,
    pub content: String,
    pub created_at: String,
    pub tags: Vec<String>,
    pub links: Vec<super::note_links::OutboundLink>,
}

/// 保存路径的正文解析(标签剥离/空白归一/解析入口):自 notes.rs 拆出守 200 行上限
#[path = "notes_parse.rs"]
pub(crate) mod notes_parse;
pub(crate) use notes_parse::{parse_saved, strip_tags_known};

/// 新建笔记(事务):剥离/提取正文标签,再把自动时间标签一并写入(D4/D5)。
/// 输入栏与主窗 Composer 保存共用此路径;时间标签与笔记同事务落库(要么都在,要么都不在)。
/// 自动标签路径由设置决定(开关 + 模板),关闭或模板非法时降级为不加。
pub fn create(conn: &mut Connection, content: &str) -> rusqlite::Result<Note> {
    let auto = crate::db::repos::settings::auto_time_path(conn)?;
    create_with(conn, content, auto.as_deref())
}

/// 仅测试用:构造不含自动时间标签的笔记,供普通标签行为用例
#[cfg(test)]
pub(crate) fn create_plain(conn: &mut Connection, content: &str) -> rusqlite::Result<Note> {
    create_with(conn, content, None)
}

/// 仅测试用:构造带指定日期自动时间标签的笔记(按默认模板生成;日期非法则不加)
#[cfg(test)]
pub(crate) fn create_on(conn: &mut Connection, content: &str, date: &str) -> rusqlite::Result<Note> {
    let path = crate::timetag::auto_time_path(crate::timetag::DEFAULT_TEMPLATE, date);
    create_with(conn, content, path.as_deref())
}

/// 创建事务内核:`time_tag` 为要一并写入的自动时间标签路径(None = 不加)。
/// 自动标签**必须与正文标签在同一次 link_paths 里写入** —— link_paths 是替换语义,
/// 分两次调用会把前一次写的链接整体抹掉。
fn create_with(
    conn: &mut Connection,
    content: &str,
    time_tag: Option<&str>,
) -> rusqlite::Result<Note> {
    let (mut names, text) = parse_saved(conn, content)?;
    if let Some(p) = time_tag.filter(|p| !names.iter().any(|n| n == *p)) {
        names.push(p.to_string());
    }
    let tx = conn.transaction()?;
    // 阶段 4:老 `notes` 表已下架,笔记行只落 `entities(kind='note')`。
    // id 显式取笔记区间 `MAX(id)+1`(而不是 rowid 自增):标签实体占 `>= TAG_ID_OFFSET`,
    // 直接自增会一路涨进标签区间。
    let id: i64 = tx.query_row(
        "SELECT COALESCE(MAX(id), 0) + 1 FROM entities WHERE kind = 'note'",
        [],
        |r| r.get(0),
    )?;
    tx.execute(
        "INSERT INTO entities(id, kind, content, created_at)
         VALUES(?1, 'note', ?2, datetime('now', 'localtime'))",
        params![id, text],
    )?;
    // 006 起 tags 为树:按路径自动建父级并做增量链接(孤儿回收已收窄为"无链接且无子");
    // 阶段 4 起链接落在 edges(kind='tagging'),方向 笔记 -> 标签(见 T4.1)。
    crate::db::repos::tags::link_paths(&tx, id, &names)?;
    // 链接紧随标签之后(D6):两步同一事务,任一步 `?` 失败连上面的 INSERT 一起回滚;
    // 扫的是**已剥标签、即刚落库的那份正文**(text),与 update 路径同一口径。
    crate::db::repos::note_links::replace_from_body(&tx, id, &text)?;
    let note = read_full(&tx, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
    tx.commit()?;
    Ok(note)
}

/// 笔记读取与行映射(自 notes.rs 拆出以守 200 行上限):read_full/recent/delete
#[path = "notes_read.rs"]
pub mod notes_read;
#[cfg(test)]
pub(crate) use notes_read::recent;
pub(crate) use notes_read::{fold_tag_rows, map_note_row, read_full};
pub use notes_read::delete;
pub use notes_read::{all_titles, pick_titles, NoteTitle};

/// 条件对象(结构化筛选真源)与条件 -> SQL 片段生成 / 校验
#[path = "notes_filter.rs"]
pub mod notes_filter;
/// 条件组模型 + 归一(自 notes_filter.rs 拆出守 200 行)
#[path = "notes_filter_groups.rs"]
pub mod notes_filter_groups;
/// 条件组 -> SQL 谓词编译与校验(自 notes_filter_groups.rs 再拆出)
#[path = "notes_filter_groups_compile.rs"]
pub mod notes_filter_groups_compile;
/// 排序数据模型(SortCond / 生效排序 / 校验;自 notes_filter.rs 拆出守 200 行)
#[path = "notes_sort.rs"]
pub mod notes_sort;
/// 标签树序键与「按标签轴排序」SQL 片段(排序后端专用)
#[path = "tag_order.rs"]
pub mod tag_order;
/// 分页/排序/折叠的公共件(平铺与分组共用,自 notes_query.rs 拆出守 200 行)
#[path = "notes_page.rs"]
pub mod notes_page;
/// 分组键的 SQL 片段(轴 -> 一级子标签)
#[path = "notes_group_key.rs"]
pub mod notes_group_key;
/// 分组数据模型 + 组骨架聚合 + 行折叠
#[path = "notes_group.rs"]
pub mod notes_group;
/// 分组首屏与组内续页查询
#[path = "notes_group_query.rs"]
pub mod notes_group_query;
pub use notes_filter::{validate as validate_conditions, FilterConditions};

/// 查询/更新拆分模块(守 200 行上限);re-export 保持 repos::notes::* 路径不变
#[path = "notes_query.rs"]
pub mod notes_query;
pub use notes_query::query;

#[path = "notes_update.rs"]
pub mod notes_update;
pub use notes_update::update;

#[cfg(test)]
#[path = "notes_filter_tests.rs"]
mod notes_filter_tests;

#[cfg(test)]
#[path = "notes_filter_groups_tests.rs"]
mod notes_filter_groups_tests;

#[cfg(test)]
#[path = "notes_tests.rs"]
mod notes_tests;

#[cfg(test)]
#[path = "notes_time_tests.rs"]
mod notes_time_tests;

#[cfg(test)]
#[path = "notes_strip_tests.rs"]
mod notes_strip_tests;

#[cfg(test)]
#[path = "notes_save_fallback_tests.rs"]
mod notes_save_fallback_tests;
