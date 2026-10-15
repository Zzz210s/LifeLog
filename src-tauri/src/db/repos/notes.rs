use rusqlite::{params, Connection};
use serde::Serialize;

/// 一条标签线出 IPC 的形状(设计 §5.2):目标**完整路径**(标签名只在文本里,路径是树语义真源)
/// + 关系名(`lines.name_id` 指向的纯名字点的 `meta`;无名字线为 None)。
/// 与解析层的 [`crate::tags::TagLine`] 同义,但纯语法模块不背 serde,故这里是 DTO 真源。
/// **结构体替换而非新增字段**:所有消费方在 `cargo`/`tsc` 编译期强制过一遍,没有第二套并行数组。
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteTag {
    pub path: String,
    pub relation_name: Option<String>,
}

#[cfg(test)]
impl NoteTag {
    /// 仅测试用:**无名字**的线(断言无名线时用它;名字字段没被丢掉 —— 名线用例写全字段)
    pub(crate) fn plain(path: &str) -> Self {
        NoteTag { path: path.to_string(), relation_name: None }
    }
}

/// 笔记(流查询与单条读回的统一结构)。
/// `created_at` 是物理列:排序(D1 改按 id,与它同序)与筛选都不再用它,只作展示与导出。
/// `links` 是正文里的出链(L2 渲染 chip 用):单条读取与分页查询都会带上,
/// 未解析的链接也保留一行(`target_id`/`title` 为 None),前端据此画未解析样式。
#[derive(Serialize, Debug)]
pub struct Note {
    pub id: i64,
    pub content: String,
    pub created_at: String,
    pub tags: Vec<NoteTag>,
    pub links: Vec<super::note_links::OutboundLink>,
}

/// 保存路径的正文解析(标签剥离/空白归一/解析入口):自 notes.rs 拆出守 200 行上限
#[path = "notes_parse.rs"]
pub(crate) mod notes_parse;
pub(crate) use notes_parse::{parse_saved, strip_tags_known};

/// 新建笔记(事务):剥离/提取正文标签,再把自动时间标签一并写入(D4/D5)。
/// 输入栏与主窗 Composer 保存共用此路径;时间标签与笔记同事务落库(要么都在,要么都不在)。
/// 自动标签路径由设置决定(开关 + 模板),关闭或模板非法时降级为不加。
/// 自动标签必须与正文标签在同一批写入(`write_saved_links` 是替换语义)。
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
/// 自动标签**必须与正文标签求并集后一次写入** —— `write_saved_links` 是替换语义,
/// 分两次调用会把前一次写的链接整体抹掉。
pub(crate) fn create_with(
    conn: &mut Connection,
    content: &str,
    time_tag: Option<&str>,
) -> rusqlite::Result<Note> {
    // 落库吃的是「目标 + 名字组」(`TagLine`):名字点的解析与落线语义见设计 §6.2/§6.3
    let (mut lines, text) = parse_saved(conn, content)?;
    if let Some(p) = time_tag.filter(|p| !lines.iter().any(|l| l.path == *p)) {
        lines.push(crate::tags::TagLine { path: p.to_string(), name: None });
    }
    let tx = conn.transaction()?;
    // 统一元数据(v28):笔记行只落 `points(meta)`,不再有 kind;id 取全表 `MAX(id)+1`
    // (spec §2.2 全库连号:笔记与标签同一命名空间,复用一个自增序列)。
    let id: i64 = tx.query_row(
        "SELECT COALESCE(MAX(id), 0) + 1 FROM points",
        [],
        |r| r.get(0),
    )?;
    tx.execute(
        "INSERT INTO points(id, meta, created_at)
         VALUES(?1, ?2, datetime('now', 'localtime'))",
        params![id, text],
    )?;
    // 标签与链接同一种边:`#X` 与 `[[X]]` 的目标求并集后一次落库(见 write_saved_links)。
    write_saved_links(&tx, id, &lines, &text)?;
    let note = read_full(&tx, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)?;
    tx.commit()?;
    Ok(note)
}

/// 保存路径的引用写入(设计 §6.1 漏斗的末端):标签线(目标 + 关系名)与 `[[ ]]` 目标求**并集**后
/// 一次整体替换 —— 同一种线,分两次替换会互相抹掉。期望线表的构造(含名字点解析,与关系面板
/// 写入同口径)与落库都在 [`note_links::write`]。返回期望线表,供调用方做审计对读。
/// 在调用方事务内执行,失败整批回滚。
fn write_saved_links(
    tx: &rusqlite::Transaction<'_>,
    id: i64,
    lines: &[crate::tags::TagLine],
    body: &str,
) -> rusqlite::Result<Vec<(i64, Option<i64>)>> {
    let desired = crate::db::repos::note_links::write::desired_lines(tx, id, lines, body)?;
    crate::db::repos::note_links::replace_lines(tx, id, &desired)?;
    Ok(desired)
}

/// 笔记读取与行映射(自 notes.rs 拆出以守 200 行上限):read_full/recent/delete
#[path = "notes_read.rs"]
pub mod notes_read;
#[cfg(test)]
pub(crate) use notes_read::recent;
pub(crate) use notes_read::{columns, fold_tag_rows, map_note_row, read_full, TAG_JOINS};
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
#[path = "notes_filter_treemembership_tests.rs"]
mod notes_filter_treemembership_tests;

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

/// 读取面的名字上浮(设计 §5.2):read_full / 平铺尾查询 / 分组尾查询三条路径
#[cfg(test)]
#[path = "notes_tag_name_tests.rs"]
mod notes_tag_name_tests;

#[cfg(test)]
#[path = "notes_save_fallback_tests.rs"]
mod notes_save_fallback_tests;
