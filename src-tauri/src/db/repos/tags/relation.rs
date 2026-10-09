//! 标签关系(relation)数据层(设计 2026-10-06 §2 §4):一条边取代「携带 / 类型 / 设为类型」三个概念。
//!
//! `edges(kind='link', source_id = A, target_id = B, remark = 属性名)` 读作
//! 「A 具有「属性名」所表示的属性，值是 B」，如 `作者/丸尾常喜 --(国籍)--> 地点轴/日本`；
//! 方向固定 A -> B；任何标签都可被指向（`tags.is_type` 已由迁移 022 取消）。
//! 028 起关系的判别不再是 `kind` 而是**来源是树内实体**:老 `relation` 与 `tagging` 都并入 `link`,
//! 树内来源(`path IS NOT NULL`)的 `link` 即关系,树外来源(笔记正文里的 `[[ ]]`)不算。
//! 唯一约束 `(source_id, kind, target_id)` 天然去重，重复添加幂等。
//! 两端有外键：删除标签时指向它的边由 `ON DELETE CASCADE` 清理。
//!
//! 语义口径（设计 §4，勿在此处自由发挥）:
//! - 只查一跳，不传递：A→B、B→C ≠ A→C（R1）
//! - 拒绝自指向与环：A→A、A→B→A、A→B→C→A 一律拒绝（R3）
//! - 箭头上的属性名**存在边上**（`tag_links.remark`，迁移 023）：读作「A 具有「属性名」所表示的
//!   属性，值是 B」，例如 `作者/丸尾常喜 --(国籍)--> 地点轴/日本`。同一个 `地点轴/日本`
//!   可以既是「国籍」又是「出生地」，所以属性名不能借用目标标签自己名字里的 md 备注
//!   （`[国籍](国别)` 那只驱动标签名的悬浮显示）。属性名只影响显示，不参与筛选 / FTS / 计数（R6）
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashSet;

/// 关系边一端(供菜单、侧栏与关系图信息条直读):目标标签 id + 完整路径 + 末段名 + **边上的属性名**
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RelationRef {
    pub to_tag_id: i64,
    pub path: String,
    pub name: String,
    /// 边上的属性名(`tag_links.remark`):`A --(国籍)--> B` 的 `国籍`;空串 = 只声明有关系
    pub remark: String,
}

/// 关系链深度上限:正常标签体系远达不到，只在数据异常时兜底，避免环上死循环
const MAX_RELATION_DEPTH: usize = 64;

/// 建立关系 A → B(幂等)：校验两端存在 -> 拒绝自指向 -> 沿关系方向 DFS 查环 -> upsert。
/// 整事务:校验失败或写入失败都零变化。关系行**不**参与 FTS / 路径 / 笔记标签集合，
/// 故这里有意不调 `tags_write::finish`（与迁移前的携带写入同一口径）。
///
/// `remark` 是**边上**的属性名(可空 = 只声明有关系)。已存在同向边时只改这一行的属性名，
/// 不增行 —— upsert 的 UPDATE 只命中 `target_type='tag'` 行，FTS 的两个聚合触发器都带
/// `WHEN target_type='note'`，所以不会造成索引漂移(003 那条「禁止 UPDATE」的约束是针对笔记链接的)。
pub fn set_tag_relation(
    conn: &mut Connection,
    from_tag_id: i64,
    to_tag_id: i64,
    remark: &str,
) -> Result<(), String> {
    if from_tag_id == to_tag_id {
        return Err("不能建立指向自己的关系".into());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let from = path_of(&tx, from_tag_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("标签不存在: {from_tag_id}"))?;
    let to = path_of(&tx, to_tag_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("标签不存在: {to_tag_id}"))?;
    // 新边 A -> B 成环 <=> 已存在 B -> ... -> A 的路径
    if reaches(&tx, to_tag_id, from_tag_id).map_err(|e| e.to_string())? {
        return Err(format!("会形成循环：建立「{from}」到「{to}」的关系会让「{from}」绕回自己"));
    }
    tx.execute(
        "INSERT INTO edges(source_id, target_id, kind, remark, created_at)
         VALUES(?1, ?2, 'link', ?3, datetime('now', 'localtime'))
         ON CONFLICT(source_id, kind, target_id) DO UPDATE SET remark = excluded.remark
         WHERE edges.remark IS NOT excluded.remark",
        params![from_tag_id, to_tag_id, remark],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// 移除关系 A → B(幂等：不存在也算成功)。单条 DELETE 本身原子，无需显式事务。
pub fn remove_tag_relation(
    conn: &mut Connection,
    from_tag_id: i64,
    to_tag_id: i64,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM edges WHERE source_id = ?1 AND kind = 'link' AND target_id = ?2",
        params![from_tag_id, to_tag_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 本标签的全部出边(A → ?)，按目标路径升序；每项带**边上**的属性名
pub fn list_tag_relations(conn: &Connection, from_tag_id: i64) -> rusqlite::Result<Vec<RelationRef>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.path, l.remark FROM edges l JOIN entities t ON t.id = l.target_id \
         WHERE l.source_id = ?1 AND l.kind = 'link' AND t.path IS NOT NULL ORDER BY t.path",
    )?;
    let rows = stmt.query_map(params![from_tag_id], |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
    })?;
    rows.map(|row| row.map(|(id, path, remark)| relation_ref(id, &path, remark))).collect()
}

/// 指向本标签的边数(删除确认文案「该标签被 N 个标签指向」的读数):
/// 只数 `target_id` 就是本标签的直接入边 —— 不含传递，也**不含指向子孙标签的边**;
/// 028 起只算树内来源(标签关系),笔记的 `link` 入边不算「被标签指向」。
pub fn count_relations_to(conn: &Connection, to_tag_id: i64) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM edges WHERE kind = 'link' AND target_id = ?1
           AND source_id IN (SELECT id FROM entities WHERE path IS NOT NULL)",
        params![to_tag_id],
        |r| r.get(0),
    )
}

/// 由 (id, path, 边上的属性名) 组装一条关系读数：name = 路径末段
pub(super) fn relation_ref(to_tag_id: i64, path: &str, remark: String) -> RelationRef {
    let name = leaf(path);
    RelationRef { to_tag_id, path: path.to_string(), name, remark }
}

/// 标签路径;不存在返回 None(供"标签不存在"中文报错)
fn path_of(conn: &Connection, id: i64) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT path FROM entities WHERE id = ?1 AND path IS NOT NULL",
        params![id],
        |r| r.get(0),
    )
    .optional()
}

/// 路径末段(标签名);`/` 是路径分隔符，单段路径即整串
pub(super) fn leaf(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

/// 名字里的 md 备注（如 `[国籍](国别)`）由前端的 `renderTagLabel` 直接从标签名解析，
/// **不再**参与关系显示：属性名存在边上（迁移 023），同一个目标标签可以承担多个属性名。
/// 沿「关系」方向(A -> B)从 `from` 出发能否到达 `to`。
/// 迭代 DFS + 已访集合:数据异常成环时也不会死循环;访问节点数超过上限即报错兜底。
/// 同模块的合并路径(merge)复用它判「迁移后是否成环」，故对 tags 子树可见。
pub(super) fn reaches(conn: &Connection, from: i64, to: i64) -> rusqlite::Result<bool> {
    let mut seen: HashSet<i64> = HashSet::new();
    let mut stack = vec![from];
    while let Some(cur) = stack.pop() {
        if cur == to {
            return Ok(true);
        }
        if !seen.insert(cur) {
            continue;
        }
        if seen.len() > MAX_RELATION_DEPTH {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "关系链超过 {MAX_RELATION_DEPTH} 层,拒绝写入"
            )));
        }
        let mut stmt = conn.prepare(
            "SELECT target_id FROM edges WHERE source_id = ?1 AND kind = 'link'",
        )?;
        let rows = stmt.query_map(params![cur], |r| r.get::<_, i64>(0))?;
        for row in rows {
            stack.push(row?);
        }
    }
    Ok(false)
}

#[cfg(test)]
#[path = "relation_tests.rs"]
mod relation_tests;

#[cfg(test)]
#[path = "relation_read_tests.rs"]
mod relation_read_tests;

#[cfg(test)]
#[path = "relation_remark_tests.rs"]
mod relation_remark_tests;
