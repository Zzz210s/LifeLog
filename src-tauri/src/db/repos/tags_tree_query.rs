//! 标签树查询(自 tags_tree.rs / ops 拆出以守 200 行上限):计数 / 补全 / 影响面。
use super::{subtree_ids, COMPLETE_LIMIT};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashSet;

/// 标签树节点计数(供标签面板):id 供侧栏右键管理(rename/move/delete/tag_impact 都按 id 寻址);
/// self_count 为本级**去重笔记数**,subtree_count 含全部子孙的**去重笔记数**(两者同一口径,
/// 与标签筛选/标签页计数一致 —— 一条笔记同时链了子树内的多个节点时只算一条);
/// sort_order 供前端同层次序(S8):兄弟展示序 = (sort_order, path),与后端写入口径一致
#[derive(Serialize, Debug, PartialEq)]
pub struct TagCount {
    pub id: i64,
    pub path: String,
    pub depth: i64,
    pub sort_order: i64,
    pub self_count: i64,
    pub subtree_count: i64,
}

/// 全部标签及其本级 / 含子级**去重笔记数**,按 path 升序
/// (全局仍是路径序:扁平模式与补全依赖它;树模式的兄弟序由前端按 sort_order 重排)
/// **去重是必须的**:一条笔记可能同时链了子树里的父与子(如 `待办/银行` + `待办/线上`),
/// 按链接数求和会把同一条笔记算多次,使侧栏计数(809)与标签筛选结果(318)对不上。
pub fn counts(conn: &Connection) -> rusqlite::Result<Vec<TagCount>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE sub(root, leaf) AS (
           SELECT id, id FROM tags
           UNION ALL SELECT s.root, t.id FROM tags t JOIN sub s ON t.parent_id = s.leaf
         ),
         own AS (SELECT tag_id, COUNT(DISTINCT target_id) AS n FROM tag_links
                 WHERE target_type = 'note' GROUP BY tag_id),
         roll AS (SELECT sub.root AS root, COUNT(DISTINCT l.target_id) AS n
                  FROM sub JOIN tag_links l ON l.tag_id = sub.leaf AND l.target_type = 'note'
                  GROUP BY sub.root)
         SELECT t.id, t.path, t.depth, t.sort_order, COALESCE(own.n, 0), COALESCE(roll.n, 0)
         FROM tags t
         LEFT JOIN own ON own.tag_id = t.id
         LEFT JOIN roll ON roll.root = t.id
         ORDER BY t.path",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(TagCount {
            id: r.get(0)?,
            path: r.get(1)?,
            depth: r.get(2)?,
            sort_order: r.get(3)?,
            self_count: r.get(4)?,
            subtree_count: r.get(5)?,
        })
    })?;
    rows.collect()
}

/// 路径前缀补全(substr 字面比较而非 LIKE:名称可能含 % 或 _)
pub fn complete(conn: &Connection, prefix: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT path FROM tags WHERE substr(path, 1, length(?1)) = ?1 ORDER BY path LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![prefix, COMPLETE_LIMIT], |r| r.get(0))?;
    rows.collect()
}

/// 补全候选项(G3 spec §4):`kind` 为 `"tag"`(标签路径前缀命中)或
/// `"alias"`(别名前缀命中,`path` 是别名目标标签的**当前路径** —— 别名存的是指向,
/// 目标改名/移动后这里给的是新路径)
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompleteItem {
    pub path: String,
    pub kind: String,
}

/// 带别名的补全(命令层 `complete_tags` 的唯一数据源):标签项在前(语义与顺序同 `complete`,
/// 路径升序),别名项按目标路径升序追加;按 path 去重且**标签优先**(别名不得遮蔽真实标签);
/// 整体上限仍是 COMPLETE_LIMIT。别名项不做二次前缀过滤:后端已按**别名字符串**前缀筛过,
/// 目标路径通常与别名字符串不同形(如别名 `日漫` -> 路径 `追番/日漫`)。
pub fn complete_with_aliases(
    conn: &Connection,
    prefix: &str,
) -> rusqlite::Result<Vec<CompleteItem>> {
    let mut out: Vec<CompleteItem> = complete(conn, prefix)?
        .into_iter()
        .map(|path| CompleteItem { path, kind: "tag".into() })
        .collect();
    let mut seen: HashSet<String> = out.iter().map(|i| i.path.clone()).collect();
    for path in alias_targets(conn, prefix)? {
        if seen.insert(path.clone()) {
            out.push(CompleteItem { path, kind: "alias".into() });
        }
    }
    out.truncate(COMPLETE_LIMIT as usize);
    Ok(out)
}

/// 别名字符串前缀命中 -> 目标标签当前路径(按目标路径升序;多个别名可指向同一标签,
/// 重复项由调用方按 path 去重)。前缀比较与标签一致用 substr,存量别名可能含 % 或 _
fn alias_targets(conn: &Connection, prefix: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT t.path FROM tag_aliases a JOIN tags t ON t.id = a.tag_id
         WHERE substr(a.alias, 1, length(?1)) = ?1 ORDER BY t.path LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![prefix, COMPLETE_LIMIT], |r| r.get(0))?;
    rows.collect()
}

/// 影响面:(子孙标签数, 子树内**去重后的笔记数**)。供删除前二次确认;
/// 去重是必要的:一条笔记可能同时链接子树内的父与子标签,否则会重复计数;
/// 与 delete_subtree 一致:tag_id 不存在时报错(不能回 (0,0),否则确认弹窗会对过期 id 显示"影响 0 条")。
pub fn impact(conn: &Connection, tag_id: i64) -> rusqlite::Result<(i64, i64)> {
    let ids = subtree_ids(conn, tag_id)?;
    if ids.is_empty() {
        return Err(rusqlite::Error::InvalidParameterName(format!(
            "标签不存在: {tag_id}"
        )));
    }
    let marks = vec!["?"; ids.len()].join(",");
    let notes: i64 = conn.query_row(
        &format!(
            "SELECT COUNT(DISTINCT target_id) FROM tag_links
             WHERE target_type = 'note' AND tag_id IN ({marks})"
        ),
        rusqlite::params_from_iter(ids.iter()),
        |r| r.get(0),
    )?;
    Ok((ids.len() as i64 - 1, notes))
}

