//! 关系线的只读读数(自 relation.rs 拆出以守 200 行上限):逐标签出线、
//! 入线计数与单条读数组装。读的都是 `lines` + `points`,不写库。
use rusqlite::{params, Connection};
use serde::Serialize;

/// 关系线一端(供菜单、侧栏与关系图信息条直读):目标点 id + 完整路径 + 末段名 + **线名**
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RelationRef {
    pub to_tag_id: i64,
    pub path: String,
    pub name: String,
    /// 线名点 id(`lines.name_id`;None = 无名字线)
    pub name_id: Option<i64>,
    /// 线名文本(名字点的 `meta`;无名字线为空串)
    pub name_text: String,
    /// 线 id(`lines.id`):按**身份**删线的唯一凭据。
    /// 派生键 `(to_tag_id, name_id)` 会被名字框的编辑漂移(清空名字 = 该线 `name_id` 变 NULL),
    /// 那时按旧名字点删会命中 0 行而 `remove_tag_relation` 视作幂等成功(T3.5)。
    pub line_id: i64,
}

/// 本标签的全部出线(A → ?),按目标路径升序;每项带线的名字点 id 与文本(无名字线为 None/空串)
pub fn list_tag_relations(conn: &Connection, from_tag_id: i64) -> rusqlite::Result<Vec<RelationRef>> {
    let mut stmt = conn.prepare(
        "SELECT l.id, t.id, t.path, l.name_id, COALESCE(n.meta, '') FROM non_tree_lines l
         JOIN points t ON t.id = l.to_id AND t.path IS NOT NULL
         LEFT JOIN points n ON n.id = l.name_id
         WHERE l.from_id = ?1 ORDER BY t.path",
    )?;
    let rows = stmt.query_map(params![from_tag_id], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, Option<i64>>(3)?,
            r.get::<_, String>(4)?,
        ))
    })?;
    rows.map(|row| row.map(|(line_id, id, path, name_id, name_text)| relation_ref(line_id, id, &path, name_id, name_text)))
        .collect()
}

/// 指向本标签的线数(删除确认文案「该标签被 N 个标签指向」的读数):
/// 只数 `to_id` 就是本标签的直接入线 —— 不含传递,也**不含指向子孙标签的线**;
/// 只算树内来源(标签关系)且排除子级线,笔记的链接入线不算「被标签指向」。
pub fn count_relations_to(conn: &Connection, to_tag_id: i64) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM non_tree_lines WHERE to_id = ?1
           AND from_id IN (SELECT id FROM points WHERE path IS NOT NULL)",
        params![to_tag_id],
        |r| r.get(0),
    )
}

/// 由 (线 id, 目标 id, path, 线名点 id, 线名文本) 组装一条关系读数:name = 路径末段
pub fn relation_ref(
    line_id: i64,
    to_tag_id: i64,
    path: &str,
    name_id: Option<i64>,
    name_text: String,
) -> RelationRef {
    let name = leaf(path);
    RelationRef { to_tag_id, path: path.to_string(), name, name_id, name_text, line_id }
}

/// 路径末段(标签名);`/` 是路径分隔符，单段路径即整串
pub fn leaf(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}
