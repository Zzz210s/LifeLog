//! 标签页条件级联(取代已删的 saved_views_rewrite;spec 2026-09-17 S6/S7):
//! 标签改名/移动时,同一事务里同步重写 `settings.tabs_state` 里每个标签页的条件 JSON ——
//! 按前缀规则重写 tags[] / exclude_tags[] 与表达式里的标签 token(与 tags 表的子树路径
//! 重写同款口径:段边界由显式 `/` 保证,`工作X` 不会被 `工作` 误伤)。
//! 删除标签**不**改写(数据源换成 settings 后,已删路径的标签页自然筛不出笔记,由用户自行调整)。
//! 坏 JSON / 坏条件对象跳过(不动、不失败);调用方(tags_tree_ops)把本模块收进结构变更事务内,
//! 任一步失败整体回滚。
use super::notes::FilterConditions;
use super::settings::{self, TABS_STATE_KEY};
use crate::expr::lexer::{lex_spans, Token};
use rusqlite::Connection;

/// 单条路径按前缀规则改写:精确等于 old 或以 `old + '/'` 开头 -> 前缀替换为 new;其余不动
fn rewrite_path(path: &str, old: &str, new: &str) -> Option<String> {
    if path == old {
        return Some(new.to_string());
    }
    let sep = format!("{old}/");
    path.strip_prefix(&sep).map(|rest| format!("{new}/{rest}"))
}

/// 单个条件对象按前缀规则改写:两侧标签列表 + 表达式文本;有变化返回 true
/// (include_children 等其余字段原样保留)
fn rewrite_conditions(c: &mut FilterConditions, old: &str, new: &str) -> bool {
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

/// 逐标签页处理 tabs_state:解析每个 conditions 交给闭包,返回 true 表示有变化需整行回写;
/// 解析失败的条件跳过(不动、不失败)。先收齐再改写,避免遍历与回写交叉。
fn map_tabs<F>(conn: &Connection, f: F) -> rusqlite::Result<()>
where
    F: Fn(&mut FilterConditions) -> bool,
{
    let Some(raw) = settings::get(conn, TABS_STATE_KEY)? else {
        return Ok(()); // 键缺失:还没开过标签页,无级联可言
    };
    let Ok(mut root) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Ok(()); // 坏 JSON:不动、不失败(与旧 saved_views 口径一致)
    };
    let Some(tabs) = root.get_mut("tabs").and_then(|t| t.as_array_mut()) else {
        return Ok(());
    };
    let mut changed = false;
    for tab in tabs.iter_mut() {
        let Some(conds) = tab.get("conditions") else {
            continue;
        };
        let Ok(mut c) = serde_json::from_value::<FilterConditions>(conds.clone()) else {
            continue; // 坏条件对象:跳过该页
        };
        if !f(&mut c) {
            continue;
        }
        tab["conditions"] = serde_json::to_value(&c)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        changed = true;
    }
    if changed {
        settings::set(conn, TABS_STATE_KEY, &root.to_string())?;
    }
    Ok(())
}

/// 改名/移动后级联:tabs_state 全部标签页的 tags[] / exclude_tags[] / expr 按前缀规则改写;
/// 有变化的页整行回写,title / activeIndex / include_children 等其余字段原样保留。
pub(crate) fn rewrite_prefix(conn: &Connection, old: &str, new: &str) -> rusqlite::Result<()> {
    map_tabs(conn, |c| rewrite_conditions(c, old, new))
}

#[cfg(test)]
#[path = "tabs_rewrite_tests.rs"]
mod tests;
