//! 时间轴收敛引擎单测的公共夹具(自 tests.rs 拆出以守 200 行上限)。
//! 夹具手建两套约定:v1 `时间/2026/10/05` + v2 `时间/日期/{2025,2026}`,
//! 其中 `2026` 年与 `2026/10` 月各与既有 v1 容器同名(两处同名整棵合并)。
use crate::db::repos::{notes, tags};
use rusqlite::Connection;

pub(crate) fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    crate::db::migrate::run(&c).unwrap();
    c
}

/// 建一条标签路径(逐级复用/创建),返回叶子 id
pub(crate) fn tag(c: &Connection, path: &str) -> i64 {
    let segments: Vec<String> = path.split('/').map(str::to_string).collect();
    tags::ensure_path(c, &segments).unwrap()
}

/// 建一篇带多个日标签的笔记(标签写在正文里,走生产解析路径)
pub(crate) fn note_with_tags(c: &mut Connection, paths: &[&str], content: &str) {
    let body = paths
        .iter()
        .fold(content.to_string(), |acc, p| format!("{acc} #{p}"));
    notes::create_plain(c, &body).unwrap();
}

/// 建一篇带日标签的笔记:标签写在正文里,走生产解析路径(建树 + 建线)
pub(crate) fn note_with_tag(c: &mut Connection, path: &str, content: &str) {
    note_with_tags(c, &[path], content);
}

pub(crate) fn seed(c: &mut Connection) {
    note_with_tag(c, "时间/2026/10/05", "v1 十月五日");
    note_with_tag(c, "时间/日期/2025/08/01", "v2 二〇二五");
    note_with_tag(c, "时间/日期/2026/10/04", "v2 十月四日");
    note_with_tag(c, "时间/日期/2026/09/12", "v2 九月十二");
}

pub(crate) fn fixture() -> Connection {
    let mut c = db();
    seed(&mut c);
    c
}

/// 抓计划 -> 执行(自对账失败会 unwrap 失败)
pub(crate) fn apply(c: &mut Connection) -> Vec<String> {
    let plan = super::s1_tree::plan(c).unwrap();
    super::s1_tree::apply(c, &plan).unwrap()
}

pub(crate) fn paths(c: &Connection) -> Vec<(String, i64)> {
    let mut stmt = c
        .prepare("SELECT path, depth FROM points WHERE path IS NOT NULL ORDER BY path")
        .unwrap();
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    rows.map(|r| r.unwrap()).collect()
}

pub(crate) fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM points WHERE path = ?1", [path], |r| {
        r.get(0)
    })
    .unwrap()
}

/// 该笔记的标签路径(升序),与引擎的 E1 读数同一条 SQL
pub(crate) fn tags_of(c: &Connection, id: i64) -> Vec<String> {
    let joined: String = c
        .query_row(
            "SELECT COALESCE((SELECT group_concat(x.path, char(10)) FROM (
                 SELECT t.path AS path FROM lines e JOIN points t ON t.id = e.to_id
                  WHERE e.from_id = ?1 AND (e.name_id IS NULL OR e.name_id <> 0)
                    AND t.path IS NOT NULL ORDER BY t.path) AS x), '')",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    joined
        .split('\n')
        .filter(|p| !p.is_empty())
        .map(str::to_string)
        .collect()
}

pub(crate) fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}
