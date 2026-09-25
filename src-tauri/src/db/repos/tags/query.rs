//! 标签树查询(自 tags_tree.rs / ops 拆出以守 200 行上限):计数 / 补全 / 影响面。
use super::{subtree_ids, COMPLETE_LIMIT};
use super::similar::{similar_paths, SIMILAR_MAX, SIMILAR_TRIGGER};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashSet;

// 模糊扩展档(前缀/别名之外的子串 + 子序列命中):查询侧的私有子模块
#[path = "complete_fuzzy.rs"]
mod complete_fuzzy;

#[cfg(test)]
#[path = "tree_complete_fuzzy_tests.rs"]
mod tree_complete_fuzzy_tests;

/// 标签树节点计数(供标签面板):id 供侧栏右键管理(rename/move/delete/tag_impact 都按 id 寻址);
/// self_count 为本级**去重笔记数**,subtree_count 含全部子孙的**去重笔记数**(两者同一口径,
/// 与标签筛选口径一致 —— 一条笔记同时链了子树内的多个节点时只算一条);
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

/// 补全候选项(G3 spec §4 + G4 spec §2 D8):`kind` 为
/// `"tag"`(标签路径前缀命中)、`"alias"`(别名前缀命中,`path` 是别名目标标签的**当前路径** ——
/// 别名存的是指向,目标改名/移动后这里给的是新路径)或 `"similar"`(近义提示项,见下)。
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompleteItem {
    pub path: String,
    pub kind: String,
}

/// 带别名与近义项的补全(命令层 `complete_tags` 的唯一数据源):标签项在前(前缀命中语义与顺序同 `complete`,
/// 路径升序;其后可跟模糊扩展档),别名项按目标路径升序追加;按 path 去重且**标签优先**(别名不得遮蔽真实标签);
/// 整体上限仍是 COMPLETE_LIMIT。别名项不做二次前缀过滤:后端已按**别名字符串**前缀筛过,
/// 目标路径通常与别名字符串不同形(如别名 `日漫` -> 路径 `追番/日漫`)。
/// 模糊扩展档(A6a)与近义项(G4)都只在标签 + 别名候选**占不满前端展示上限**时才去取
/// (前者见 fuzzy_paths,后者见 SIMILAR_TRIGGER):下拉已被精确命中占满时,扩展项必然被截掉,
/// 整表取候选只是白费。模糊扩展档的路径不参与近义档(二者口径互斥,见 complete_fuzzy)。
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
    // 模糊扩展档(A6a):前缀/别名之外补子串 + 子序列命中,让输入栏与主窗 `#` 的候选池同源。
    // 放在近义档之前:扩展项是带高亮的命中(kind="tag"),近义项是末尾的提示(kind="similar");
    // 二者路径互斥(扩展档让位给近义规则),故不会互相遮蔽。
    if !prefix.is_empty() && out.len() < SIMILAR_TRIGGER {
        for path in complete_fuzzy::fuzzy_paths(conn, prefix, &seen)? {
            if seen.insert(path.clone()) {
                out.push(CompleteItem { path, kind: "tag".into() });
            }
        }
        out.truncate(COMPLETE_LIMIT as usize);
    }
    if out.len() < SIMILAR_TRIGGER {
        // seen 已含标签与别名项:相似项不重复已展示的路径(标签/别名优先)
        for path in similar_paths(&all_tag_paths(conn)?, prefix, &seen, SIMILAR_MAX) {
            seen.insert(path.clone());
            out.push(CompleteItem { path, kind: "similar".into() });
        }
        out.truncate(COMPLETE_LIMIT as usize);
    }
    Ok(out)
}

/// 近义项的候选集合:全部标签路径(路径升序)。
/// **取舍**:相似规则 ② 的"词元包含叶子名"与 ③ 的编辑距离都没有子串关系,
/// 用 instr/LIKE 做不出可靠的超集预筛(漏筛 = 丢候选),所以这里整表取路径、
/// 由纯函数 `similar_paths` 精确判定;整表扫描只在"标签 + 别名候选占不满展示上限"时才发生,
/// 量级是标签总数(百级),不构成每击键都扫表的负担。
fn all_tag_paths(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT path FROM tags ORDER BY path")?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
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

