//! saved_views 条件级联(修复轮独立跟踪项):标签改名/移动/删除子树时,同一事务里
//! 同步维护自建视图的 conditions JSON —— 改名/移动按前缀规则重写 tags[] 与 exclude_tags[]
//! (与 tags 表的子树路径重写同款口径),删除子树时被删路径的条件项直接滤掉
//! (视图变成少了那个条件,而不是坏视图)。
//! 高级表达式(`conditions.expr`)是文本条件(Task 4):改名/移动时按同一套前缀规则做
//! token 级文本重写;删除时**不改文本**(用户手写的表达式不静默改动),由 views::list
//! 的 broken_paths 报告失效路径。
//! JSON 解析失败的行跳过(不动、不失败);调用方(tags_tree_ops)把本模块收进结构变更事务内,
//! 任一步失败整体回滚。
use super::notes::FilterConditions;
use crate::expr::lexer::{lex_spans, Token};
use rusqlite::{params, Connection};

/// 单条路径按前缀规则改写:精确等于 old 或以 `old + '/'` 开头 -> 前缀替换为 new;
/// 其余(None)不动。段边界由显式 `/` 保证,`工作X` 不会被 `工作` 误伤。
fn rewrite_path(path: &str, old: &str, new: &str) -> Option<String> {
    if path == old {
        return Some(new.to_string());
    }
    let sep = format!("{old}/");
    path.strip_prefix(&sep).map(|rest| format!("{new}/{rest}"))
}

/// 路径是否在被删子树内:等于根或以 `根 + '/'` 开头
/// (条件里可能残留比真实标签更深的失效路径,整棵子树一并滤掉)
fn under_root(path: &str, root: &str) -> bool {
    path == root || path.starts_with(&format!("{root}/"))
}

/// 逐行处理 saved_views:解析 conditions JSON 交给闭包,返回 true 表示有变化需整行回写;
/// 解析失败的行跳过(不动、不失败)。先收齐再改写,避免游标与 UPDATE 交叉。
fn map_views<F>(conn: &Connection, f: F) -> rusqlite::Result<()>
where
    F: Fn(&mut FilterConditions) -> bool,
{
    let rows: Vec<(i64, String)> = {
        let mut stmt = conn.prepare("SELECT id, conditions FROM saved_views")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    for (id, json) in rows {
        let Ok(mut c) = serde_json::from_str::<FilterConditions>(&json) else {
            continue; // 坏 JSON 行:不动、不失败
        };
        if !f(&mut c) {
            continue;
        }
        let out = serde_json::to_string(&c)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        conn.execute(
            "UPDATE saved_views SET conditions = ?2 WHERE id = ?1",
            params![id, out],
        )?;
    }
    Ok(())
}

/// 改名/移动后级联:saved_views 全表 tags[] 与 exclude_tags[] 按前缀规则改写,
/// 表达式按 token 做同一套规则的重写;有变化的行整行回写,
/// include_children 等其余字段原样保留。
pub(crate) fn rewrite_prefix(conn: &Connection, old: &str, new: &str) -> rusqlite::Result<()> {
    map_views(conn, |c| {
        let mut changed = false;
        for list in [&mut c.tags, &mut c.exclude_tags] {
            for t in list.iter_mut() {
                if let Some(p) = rewrite_path(&t.path, old, new) {
                    t.path = p;
                    changed = true;
                }
            }
        }
        if let Some(src) = c.expr.as_deref() {
            let out = rewrite_expr_paths(src, old, new);
            if out != src {
                c.expr = Some(out);
                changed = true;
            }
        }
        changed
    })
}

/// 表达式文本级改写:标签 token 的路径按前缀规则换成新路径(`#old`/`#=old` -> 新),
/// `#` / `#=` 前缀与其余文本(空白、运算符、关键词、引号短语)逐字保留;
/// 词法失败时返回原文(不改、不报错)。
pub fn rewrite_expr_paths(text: &str, old: &str, new: &str) -> String {
    let Ok(spans) = lex_spans(text) else {
        return text.to_string();
    };
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0usize;
    for (token, start, end) in spans {
        let Token::Tag { path, self_only } = token else {
            continue;
        };
        let Some(new_path) = rewrite_path(&path, old, new) else {
            continue;
        };
        let path_start = start + if self_only { 2 } else { 1 };
        if path_start < cursor || end > chars.len() {
            continue; // 防御:区间与游标重叠时不改写(正常扫描不会出现)
        }
        out.extend(chars[cursor..path_start].iter());
        out.push_str(&new_path);
        cursor = end;
    }
    out.extend(chars[cursor..].iter());
    out
}

/// 表达式引用的标签路径(去重、保持出现顺序);词法失败返回空(不报错)。
pub fn expr_paths(text: &str) -> Vec<String> {
    let Ok(spans) = lex_spans(text) else {
        return Vec::new();
    };
    let mut out: Vec<String> = Vec::new();
    for (token, _, _) in spans {
        if let Token::Tag { path, .. } = token {
            if !out.contains(&path) {
                out.push(path);
            }
        }
    }
    out
}

/// 删除子树后级联:被删子树内的条件项(结构化)直接滤掉(两侧都滤),其余条件项保留。
/// 表达式**不动**:手写文本不静默改写,失效引用由 views::list 的 broken_paths 报告。
pub(crate) fn drop_subtree(conn: &Connection, root: &str) -> rusqlite::Result<()> {
    map_views(conn, |c| {
        let before = c.tags.len() + c.exclude_tags.len();
        c.tags.retain(|t| !under_root(&t.path, root));
        c.exclude_tags.retain(|t| !under_root(&t.path, root));
        c.tags.len() + c.exclude_tags.len() != before
    })
}

#[cfg(test)]
#[path = "saved_views_rewrite_tests.rs"]
mod tests;

/// Task 4 的表达式级联用例单独成文件(既有文件保持逐字不动,且两文件都守 200 行上限)
#[cfg(test)]
#[path = "saved_views_expr_tests.rs"]
mod expr_tests;
