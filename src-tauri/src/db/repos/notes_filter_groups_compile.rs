//! 条件组 -> SQL 谓词编译与校验(自 `notes_filter_groups.rs` 拆出,守 200 行)。
//! 组内按 `op` 拼、组间按 `group_op` 拼,括号显式加(不依赖 SQLite 运算符优先级);
//! 用户输入只进 `?` 参数向量,永不进 SQL 文本。
use rusqlite::types::Value;

use super::notes_filter::{
    any_tag, carry_predicate, expr_error_message, keyword_predicate, single_line_predicate,
    tag_exists, tag_predicate, tree_membership_predicate, FilterConditions,
};
use super::notes_filter_groups::{
    item_is_blank, op_of, FilterGroup, GroupItem, MAX_KEYWORD_CHARS, MAX_TAG_ITEMS,
};

/// 单项谓词(自带 EXISTS 包装 / NOT;空白与非法取值 -> None);表达式非法整条失败
pub(crate) fn item_predicate(it: &GroupItem, args: &mut Vec<Value>) -> Result<Option<String>, String> {
    let pred = match it {
        GroupItem::Keyword { value } => {
            let k = value.trim();
            if k.is_empty() {
                return Ok(None);
            }
            keyword_predicate(k, args)
        }
        GroupItem::Tag { path, include_children } => {
            tag_exists(&tag_predicate(path, !include_children, args))
        }
        GroupItem::ExcludeTag { path, include_children } => {
            let m = tag_predicate(path, !include_children, args);
            format!("NOT {}", tag_exists(&m))
        }
        GroupItem::Relation { path } => tag_exists(&carry_predicate(path, args)),
        GroupItem::ExcludeRelation { path } => {
            let m = carry_predicate(path, args);
            format!("NOT {}", tag_exists(&m))
        }
        GroupItem::Presence { value } => match value.as_str() {
            "any" => any_tag(),
            "none" => format!("NOT ({})", any_tag()),
            _ => return Ok(None),
        },
        GroupItem::TreeMembership { value } => match tree_membership_predicate(value) {
            Some(p) => p,
            None => return Ok(None),
        },
        GroupItem::SingleLine { value } => match single_line_predicate(value) {
            Some(p) => p,
            None => return Ok(None),
        },
        GroupItem::Expr { value } => {
            if item_is_blank(it) {
                return Ok(None);
            }
            let ast = crate::expr::validate(value).map_err(|e| expr_error_message(value, &e))?;
            crate::expr::compile(&ast, args)
        }
    };
    Ok(Some(pred))
}

/// 单项**命中数**谓词:排除项计的是「该条件自己的命中集」(与旧口径一致),
/// 故 excludeTag / excludeRelation 用**肯定式**(NOT 只是 WHERE 里的语义,不是读数)
pub(crate) fn item_hit_predicate(
    it: &GroupItem,
    args: &mut Vec<Value>,
) -> Result<Option<String>, String> {
    match it {
        GroupItem::ExcludeTag { path, include_children } => {
            Ok(Some(tag_exists(&tag_predicate(path, !include_children, args))))
        }
        GroupItem::ExcludeRelation { path } => Ok(Some(tag_exists(&carry_predicate(path, args)))),
        other => item_predicate(other, args),
    }
}

/// 单组片段:组内按 `op` 拼接(每一项都显式加括号),空组返回 None
pub(crate) fn group_where(g: &FilterGroup, args: &mut Vec<Value>) -> Result<Option<String>, String> {
    let mut parts: Vec<String> = Vec::new();
    for it in &g.items {
        if let Some(p) = item_predicate(it, args)? {
            parts.push(format!("({p})"));
        }
    }
    if parts.is_empty() {
        return Ok(None);
    }
    let sep = if op_of(&g.op) == "or" { " OR " } else { " AND " };
    Ok(Some(format!("({})", parts.join(sep))))
}

/// 条件 -> `WHERE` 之后的 SQL 片段与参数:组间按 `group_op` 拼接并整体再加一层括号
/// (否则 `1=1 AND (a) OR (b)` 会因 OR 优先级被解析成 `(1=1 AND a) OR b`)。无有效子句 -> `1=1`。
pub fn where_clause(c: &FilterConditions) -> Result<(String, Vec<Value>), String> {
    let mut c = c.clone();
    super::notes_filter_groups::normalize_groups(&mut c);
    let mut args: Vec<Value> = Vec::new();
    let mut frags: Vec<String> = Vec::new();
    for g in &c.groups {
        if let Some(f) = group_where(g, &mut args)? {
            frags.push(f);
        }
    }
    if frags.is_empty() {
        return Ok(("1=1".to_string(), args));
    }
    let sep = if op_of(&c.group_op) == "or" { " OR " } else { " AND " };
    Ok((format!("1=1 AND ({})", frags.join(sep)), args))
}

/// 校验(后端为唯一权威):先查**原始**组内/组间 op 取值(归一会把非法值静默压成 `and`,
/// 校验必须先拦住),再归一后逐项检查条数 / 路径 / 取值 / 表达式语义
pub fn validate_groups(c: &FilterConditions) -> Result<(), String> {
    for g in &c.groups {
        if !g.op.is_empty() && !g.op.eq_ignore_ascii_case("and") && !g.op.eq_ignore_ascii_case("or") {
            return Err(format!("组内关系取值非法: {}", g.op));
        }
    }
    if !c.group_op.is_empty()
        && !c.group_op.eq_ignore_ascii_case("and")
        && !c.group_op.eq_ignore_ascii_case("or")
    {
        return Err(format!("组间关系取值非法: {}", c.group_op));
    }
    // 平铺旧字段里的非法取值同样要拦(归一会把它们搬进组后丢掉非法值,不能因此放过)
    if let Some(p) = c.tag_presence.as_deref() {
        if p != "any" && p != "none" {
            return Err("标签有无取值非法".into());
        }
    }
    let mut c = c.clone();
    super::notes_filter_groups::normalize_groups(&mut c);
    let (mut tags, mut ex_tags, mut rels, mut ex_rels) = (0usize, 0usize, 0usize, 0usize);
    for g in &c.groups {
        for it in &g.items {
            match it {
                GroupItem::Keyword { value } => {
                    if value.trim().chars().count() > MAX_KEYWORD_CHARS {
                        return Err(format!("关键词最多 {MAX_KEYWORD_CHARS} 字"));
                    }
                }
                GroupItem::Tag { path, .. } => {
                    tags += 1;
                    if crate::tags::validate_tag_path(path).is_err() {
                        return Err(format!("标签路径不合法: {path}"));
                    }
                }
                GroupItem::ExcludeTag { path, .. } => {
                    ex_tags += 1;
                    if crate::tags::validate_tag_path(path).is_err() {
                        return Err(format!("标签路径不合法: {path}"));
                    }
                }
                GroupItem::Relation { path } => {
                    rels += 1;
                    if crate::tags::validate_tag_path(path).is_err() {
                        return Err(format!("标签路径不合法: {path}"));
                    }
                }
                GroupItem::ExcludeRelation { path } => {
                    ex_rels += 1;
                    if crate::tags::validate_tag_path(path).is_err() {
                        return Err(format!("标签路径不合法: {path}"));
                    }
                }
                GroupItem::Presence { value } => {
                    if value != "any" && value != "none" {
                        return Err("标签有无取值非法".into());
                    }
                }
                GroupItem::TreeMembership { value } => {
                    if tree_membership_predicate(value).is_none() {
                        return Err("在树内取值非法".into());
                    }
                }
                GroupItem::SingleLine { value } => {
                    if single_line_predicate(value).is_none() {
                        return Err("单行取值非法".into());
                    }
                }
                GroupItem::Expr { value } => {
                    crate::expr::validate(value).map_err(|e| expr_error_message(value, &e))?;
                }
            }
        }
    }
    if tags > MAX_TAG_ITEMS {
        return Err(format!("引入标签最多 {MAX_TAG_ITEMS} 项"));
    }
    if ex_tags > MAX_TAG_ITEMS {
        return Err(format!("排除标签最多 {MAX_TAG_ITEMS} 项"));
    }
    if rels > MAX_TAG_ITEMS {
        return Err(format!("关系最多 {MAX_TAG_ITEMS} 项"));
    }
    if ex_rels > MAX_TAG_ITEMS {
        return Err(format!("排除关系最多 {MAX_TAG_ITEMS} 项"));
    }
    Ok(())
}
