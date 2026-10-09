//! 当前筛选条件的路径级联(取代已删的 saved_views_rewrite 与标签页时代的 tabs_rewrite;
//! spec 2026-09-17 S6/S7,2026-09-25 改单份条件):
//! 标签改名/移动时,同一事务里同步重写 `settings.filter_current` 这一份条件对象 ——
//! 深度遍历 `groups[].items` 的四种路径与表达式项,以及 `sorts[].path`、`groupBy.path`
//! (与 tags 表的子树路径重写同款口径:段边界由显式 `/` 保证,`工作X` 不会被 `工作` 误伤)。
//! 删除标签**不**改写(已删路径自然筛不出笔记,由用户自行调整)。
//! 键缺失 / 坏 JSON 跳过(不动、不失败);调用方(tags_write::finish)把本模块收进结构变更事务内,
//! 任一步失败整体回滚。
use super::notes::{notes_filter::SortCond, FilterConditions};
use super::notes::notes_filter_groups::{normalize_groups, GroupItem};
use super::settings::{self, FILTER_CURRENT_KEY};
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

/// 条件对象按前缀规则改写:深度遍历 `groups[].items` 里的四种 path 与 `expr` 项 +
/// 排序的标签轴;有变化返回 true(其余字段原样保留)。
/// 平铺旧字段先经 `normalize_groups` 搬进 `groups[0]`,因此回读兼容位里的条件也照改。
fn rewrite_conditions(c: &mut FilterConditions, old: &str, new: &str) -> bool {
    let mut changed = false;
    normalize_groups(c);
    for g in c.groups.iter_mut() {
        for it in g.items.iter_mut() {
            match it {
                GroupItem::Tag { path, .. }
                | GroupItem::ExcludeTag { path, .. }
                | GroupItem::Relation { path }
                | GroupItem::ExcludeRelation { path } => {
                    if let Some(p) = rewrite_path(path, old, new) {
                        *path = p;
                        changed = true;
                    }
                }
                GroupItem::Expr { value } => {
                    let out = rewrite_expr_paths(value, old, new);
                    if out != *value {
                        *value = out;
                        changed = true;
                    }
                }
                // 关键词 / 有无标签 / 在树内 / 单行没有路径可改
                GroupItem::Keyword { .. }
                | GroupItem::Presence { .. }
                | GroupItem::TreeMembership { .. }
                | GroupItem::SingleLine { .. } => {}
            }
        }
    }
    // 排序的标签轴也是路径:漏这一段就是排序静默失效(筛选会重查,排序不会报错)
    for s in c.sorts.iter_mut() {
        if let SortCond::Tag { path, .. } = s {
            if let Some(p) = rewrite_path(path, old, new) {
                *path = p;
                changed = true;
            }
        }
    }
    // 分组的轴同样是路径,且它**不是**收窄条件(改不掉不会报错、只会分错组)
    if let Some(gb) = c.group_by.as_mut() {
        if let Some(p) = rewrite_path(&gb.path, old, new) {
            gb.path = p;
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

/// 就地改写 filter_current 的那一份条件:解析失败跳过(不动、不失败),
/// 有变化才整串回写(没命中路径时原串逐字保留,避免无谓改写);未知字段被忽略,
/// 因此旧多页形状不会解析出错,只是没有任何路径命中 -> 同样保持原文。
fn map_conditions<F>(conn: &Connection, f: F) -> rusqlite::Result<()>
where
    F: Fn(&mut FilterConditions) -> bool,
{
    let Some(raw) = settings::get(conn, FILTER_CURRENT_KEY)? else {
        return Ok(()); // 键缺失:还没有筛选条件落库,无级联可言
    };
    let Ok(mut c) = serde_json::from_str::<FilterConditions>(&raw) else {
        return Ok(()); // 坏 JSON / 字段类型不符:不动、不失败(与旧 saved_views 口径一致)
    };
    if !f(&mut c) {
        return Ok(());
    }
    let out = serde_json::to_string(&c)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    settings::set(conn, FILTER_CURRENT_KEY, &out)
}

/// 改名/移动后级联:filter_current 的 tags[] / exclude_tags[] / relations[] / exclude_relations[] / expr
/// 按前缀规则改写;有变化才回写,其余字段(keyword / sort / tag_presence / include_children)原样保留。
pub(crate) fn rewrite_filter_paths(
    conn: &Connection,
    old: &str,
    new: &str,
) -> rusqlite::Result<()> {
    map_conditions(conn, |c| rewrite_conditions(c, old, new))
}

#[cfg(test)]
#[path = "filter_rewrite_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "notes_group_rewrite_tests.rs"]
mod notes_group_rewrite_tests;
