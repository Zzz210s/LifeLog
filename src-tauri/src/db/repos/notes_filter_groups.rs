//! 筛选条件组模型(设计 2026-10-06 §5):组内 `op` 每组独立、组间一个 `group_op`,只有两级。
//! 本文件只有**数据模型与归一**(自 `notes_filter.rs` 拆出;编译/校验见
//! [`notes_filter_groups_compile`](super::notes_filter_groups_compile))。
//! `normalize_groups` 是「一种形态」的唯一闸门:旧 8 个平铺字段在归一里搬进 `groups[0]`
//! (op='and')并清空,空组丢弃;查询 / 校验 / 命中数读数一律先归一,再只认 `groups`。
use serde::{Deserialize, Serialize};

use super::notes_filter::FilterConditions;

/// 引入与排除标签各自的条数上限(与前端 `MAX_FILTER_TAG_ITEMS` 一致)
pub const MAX_TAG_ITEMS: usize = 20;
/// 关键词长度上限(字符数)
pub const MAX_KEYWORD_CHARS: usize = 200;

/// 组内一项(serde 内部标签 `kind`;字段 camelCase,缺失给默认值)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum GroupItem {
    Keyword {
        #[serde(default)]
        value: String,
    },
    Tag {
        #[serde(default)]
        path: String,
        #[serde(default)]
        include_children: bool,
    },
    ExcludeTag {
        #[serde(default)]
        path: String,
        #[serde(default)]
        include_children: bool,
    },
    Relation {
        #[serde(default)]
        path: String,
    },
    ExcludeRelation {
        #[serde(default)]
        path: String,
    },
    Presence {
        #[serde(default)]
        value: String,
    },
    Expr {
        #[serde(default)]
        value: String,
    },
}

/// 一个条件组:组内关系 + 组内项
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct FilterGroup {
    pub op: String,
    pub items: Vec<GroupItem>,
}

impl Default for FilterGroup {
    fn default() -> Self {
        Self { op: "and".to_string(), items: Vec::new() }
    }
}

/// 非法/缺省一律回落 `and`(与前端 `opOf` 同一口径)
pub(crate) fn op_of(s: &str) -> &'static str {
    if s.eq_ignore_ascii_case("or") {
        "or"
    } else {
        "and"
    }
}

/// 空白项(关键词/表达式只看 trim 后有无内容)
pub(crate) fn item_is_blank(it: &GroupItem) -> bool {
    match it {
        GroupItem::Keyword { value } | GroupItem::Expr { value } => value.trim().is_empty(),
        _ => false,
    }
}

/// 旧平铺字段展开成组内项(顺序 = 旧 `where_clause` 口径)
fn flat_items(c: &FilterConditions) -> Vec<GroupItem> {
    let mut items = Vec::new();
    if c.keyword.as_deref().map(str::trim).is_some_and(|k| !k.is_empty()) {
        items.push(GroupItem::Keyword { value: c.keyword.clone().unwrap_or_default() });
    }
    for t in &c.tags {
        items.push(GroupItem::Tag { path: t.path.clone(), include_children: t.include_children });
    }
    for t in &c.exclude_tags {
        items.push(GroupItem::ExcludeTag {
            path: t.path.clone(),
            include_children: t.include_children,
        });
    }
    for r in &c.relations {
        items.push(GroupItem::Relation { path: r.path.clone() });
    }
    for r in &c.exclude_relations {
        items.push(GroupItem::ExcludeRelation { path: r.path.clone() });
    }
    if let Some(v @ ("any" | "none")) = c.tag_presence.as_deref() {
        items.push(GroupItem::Presence { value: v.to_string() });
    }
    if c.expr.as_deref().map(str::trim).is_some_and(|e| !e.is_empty()) {
        items.push(GroupItem::Expr { value: c.expr.clone().unwrap_or_default() });
    }
    items
}

/// 归一(幂等):平铺非空 -> 前插 `groups[0]`(op='and');空组丢弃;平铺字段清空。
/// 前插而非并入 `groups[0]`:后者在 `groups[0].op == "or"` 时会改变旧条件语义。
pub fn normalize_groups(c: &mut FilterConditions) {
    let flat = flat_items(c);
    let mut groups: Vec<FilterGroup> = std::mem::take(&mut c.groups)
        .into_iter()
        .map(|g| FilterGroup {
            op: op_of(&g.op).to_string(),
            items: g.items.into_iter().filter(|it| !item_is_blank(it)).collect(),
        })
        .filter(|g| !g.items.is_empty())
        .collect();
    if !flat.is_empty() {
        groups.insert(0, FilterGroup { op: "and".to_string(), items: flat });
    }
    c.groups = groups;
    c.group_op = op_of(&c.group_op).to_string();
    c.keyword = None;
    c.tags.clear();
    c.exclude_tags.clear();
    c.relations.clear();
    c.exclude_relations.clear();
    c.tag_presence = None;
    c.expr = None;
}
