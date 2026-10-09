//! 路径 -> 标签实体 id 的解析漏斗(自 tree.rs 拆出以守 200 行上限):
//! **真实标签优先,其次别名,最后新建**,解析结果交给 replace::replace_links 落库。
//! 别名只是"这个字符串指向哪个实体"(spec D2),不建节点、不改名。
//! 统一元数据(v28):树内实体 = `path IS NOT NULL`,不再有 `kind='tag'`。
use super::ensure_path;
use crate::db::repos::tags::alias;
use rusqlite::{params, Connection};

/// 按路径**逐段寻址**树内实体(不存在返回 None);用于"真实标签优先于别名"的判定。
/// 从根开始,每段都要命中「同父 + 同名(`entity_name(meta)` 精确相等)」的树内实体,
/// 同父同名取 id 最小(P5);任一段落空即 None。**不读 `path`** —— 名字含 `/` 的实体
/// 拼出的 path 有歧义段(P3),父子关系只能由 `parent_id` 决定;`path` 只是显示缓存。
/// 这同时挡掉 006 之前的幻影层级(name=path=`a/b` 但无父节点):它连根段都不匹配。
fn existing_id(conn: &Connection, path: &str) -> rusqlite::Result<Option<i64>> {
    use rusqlite::OptionalExtension;
    let segs: Vec<&str> = path.split('/').collect();
    if segs.iter().any(|s| s.is_empty()) {
        return Ok(None); // 空段(首尾斜杠 / `a//b`)不是任何实体的名字
    }
    let mut parent: Option<i64> = None;
    for seg in &segs {
        let next: Option<i64> = conn
            .query_row(
                "SELECT id FROM entities WHERE path IS NOT NULL
                   AND parent_id IS ?1 AND entity_name(meta) = ?2
                 ORDER BY id LIMIT 1",
                params![parent, seg],
                |r| r.get(0),
            )
            .optional()?;
        match next {
            Some(id) => parent = Some(id),
            None => return Ok(None),
        }
    }
    Ok(parent)
}

/// 解析一批标签路径为**目标 id 序列**(只解析、不写库):**真实标签优先,其次别名,最后新建**。
/// ① 该路径已是存在的树内实体 -> 用它(用户确实能创建/保留同名标签,别名不该把它挡住)
/// ② 否则查别名表,命中即用目标实体本身(目标必然已存在:别名有外键、删除级联)
/// ③ 都没有 -> 原样解析并自动建树。
pub(crate) fn resolve_paths(conn: &Connection, paths: &[String]) -> rusqlite::Result<Vec<i64>> {
    let mut desired: Vec<i64> = Vec::new();
    for path in paths {
        if let Some(id) = existing_id(conn, path.trim())? {
            if !desired.contains(&id) {
                desired.push(id);
            }
            continue;
        }
        let canonical = alias::resolve(conn, path)?;
        // 别名命中:直接取目标 id,不再拿目标路径回走 parse_tag_path —— T2 起标签名
        // 可以含行内 md(`[郴](chēn)州市`),那些字符不在正文语法的名称字符集里,
        // 拿路径回解析会把自己刚桥接好的别名误判成"非法标签路径"。
        if let Some(id) = canonical.as_deref().map(|p| existing_id(conn, p)).transpose()?.flatten() {
            if !desired.contains(&id) {
                desired.push(id);
            }
            continue;
        }
        let target = canonical.as_deref().unwrap_or(path.as_str());
        let segs = crate::tags::parse_tag_path(target).ok_or_else(|| {
            rusqlite::Error::InvalidParameterName(format!("非法标签路径: {path}"))
        })?;
        let id = ensure_path(conn, &segs)?;
        if !desired.contains(&id) {
            desired.push(id);
        }
    }
    Ok(desired)
}

/// 笔记维度的链接替换(增量):只删不再需要的、只补缺失的,未变化的链接保持原样
/// (节点 id 与触发器行为稳定)。路径经 parse_tag_path 校验后走 ensure_path 自动建父级。
/// 解析顺序真源见 [`resolve_paths`]。
#[cfg(test)]
pub(crate) fn link_paths(conn: &Connection, note_id: i64, paths: &[String]) -> rusqlite::Result<()> {
    let desired = resolve_paths(conn, paths)?;
    super::replace::replace_links(conn, note_id, &desired)
}

#[cfg(test)]
#[path = "link_segment_tests.rs"]
mod link_segment_tests;
