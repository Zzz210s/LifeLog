//! 结构化筛选条件(前端 `filter-conditions.ts` 的等价定义)与条件对象入口。
//! 真源是结构化条件对象(D6),而非表达式字符串;条件组(`groups` + `groupOp`)是唯一权威形态,
//! 下面 7 个平铺字段是**旧库回读兼容位** —— `normalize_groups` 会把它们搬进 `groups[0]` 并清空。
//! 「条件 -> SQL 片段」的编译与校验见 [`notes_filter_groups`](super::notes_filter_groups)(守 200 行拆出)。
//! 谓词模板(标签/关键词)抽到 [`filter_predicates`],与表达式编译器
//! [`crate::expr::compile`] 共用同一批实现 —— 两套输入,一套语义。
//! Serialize 派生供当前筛选条件落库为 JSON(settings.filter_current)。
use serde::{Deserialize, Serialize};

/// 共用谓词真源(与表达式编译器共享,杜绝第二套标签/关键词语义)
#[path = "filter_predicates.rs"]
pub(crate) mod filter_predicates;
pub(crate) use filter_predicates::{
    carry_predicate, keyword_predicate, single_line_predicate, tag_exists, tag_predicate,
    tree_membership_predicate,
};
/// 排序数据模型与生效排序的唯一入口(自本文件拆出守 200 行)
pub use super::notes_sort::{validate_sorts, SortCond};

/// 条件组模型与编译(归一 / where_clause / 组内校验);从本模块照旧出口
pub use super::notes_filter_groups::{normalize_groups, FilterGroup};
pub use super::notes_filter_groups_compile::{validate_groups, where_clause};

/// 单个标签条件:完整路径 + 是否含子级(前端默认含子级)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct TagCond {
    pub path: String,
    pub include_children: bool,
}

/// 单个关系条件(原「类型条件」):只有被指向标签的路径 —— 关系天然含子级并叠加继承,
/// 没有「仅本级」开关。缺字段时由 `#[serde(default)]` 解析成空,兼容老库。
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct RelationCond {
    pub path: String,
}

/// 分组条件(设计 2026-10-06 §6):轴(任意标签路径)+ 组间方向。
/// 组键 = 轴下**一级子标签**(多值取树序第一,无值恒最后一组);
/// `desc` = 选项倒序(组间顺序反转,哨兵组不受影响)。缺字段时 `#[serde(default)]` 补默认。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct GroupByCond {
    pub path: String,
    pub dir: String,
}

impl Default for GroupByCond {
    fn default() -> Self {
        Self { path: String::new(), dir: "asc".to_string() }
    }
}

/// 流查询条件对象;字段名与前端 `FilterConditions` 完全一致(JSON camelCase)。
/// 平铺字段(`keyword` / `tags` / `exclude_tags` / `relations` / `exclude_relations` /
/// `tag_presence` / `expr`)只为回读旧 `filter_current`,编译前一经 `normalize_groups` 即清空。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct FilterConditions {
    pub keyword: Option<String>,
    pub tags: Vec<TagCond>,
    pub exclude_tags: Vec<TagCond>,
    /// `alias` 依次回读旧字段名 `types` / `roles`,否则级联改写会把非空旧条件静默抹成空
    #[serde(default, alias = "types", alias = "roles")]
    pub relations: Vec<RelationCond>,
    #[serde(default, alias = "excludeTypes", alias = "excludeRoles")]
    pub exclude_relations: Vec<RelationCond>,
    pub tag_presence: Option<String>,
    pub sort: Option<String>,
    /// 有序排序条件(下标即优先级;空数组 = 默认时间降序)
    pub sorts: Vec<SortCond>,
    /// 分组条件(`None` = 不分组);落点与 `sorts` 同键(filter_current)
    pub group_by: Option<GroupByCond>,
    pub expr: Option<String>,
    /// 组间关系(默认 `and`;组内关系看每个 `FilterGroup.op`)
    pub group_op: String,
    /// 条件组(空 = 没有条件组)
    pub groups: Vec<FilterGroup>,
}

/// 空条件(等价于"全部笔记,最新在前")
#[allow(dead_code)]
pub fn empty() -> FilterConditions {
    FilterConditions::default()
}

/// "挂了任意一个标签"的谓词(时间标签已是普通标签,D3:它也计数)
pub(crate) fn any_tag() -> String {
    "EXISTS (SELECT 1 FROM edges l WHERE l.kind = 'link' AND l.source_id = n.id)".to_string()
}

/// 表达式非法的用户可见中文原因(**两条路径共用同一份文案**):
/// 串内错误「表达式:第 N 个字符:原因」;位置已到文本末尾的末尾类错误改说「表达式:表达式末尾:原因」。
/// 口径与前端 `src/main-window/filter/expr-check.ts` 的 errorLabelOf 一致。
pub(crate) fn expr_error_message(src: &str, e: &crate::expr::lexer::ExprError) -> String {
    let total = src.chars().count();
    if e.pos >= total {
        format!("表达式:表达式末尾:{}", e.message)
    } else {
        format!("表达式:第 {} 个字符:{}", e.pos + 1, e.message)
    }
}

/// 分组条件校验:方向取值 + 轴路径合法性(轴不要求已存在,空轴由 validate_tag_path 拦下)
pub fn validate_group_by(g: &GroupByCond) -> Result<(), String> {
    if g.dir != "asc" && g.dir != "desc" {
        return Err("分组方向非法".into());
    }
    if crate::tags::validate_tag_path(&g.path).is_err() {
        return Err(format!("标签路径不合法: {}", g.path));
    }
    Ok(())
}

/// 校验(后端为唯一权威;前端只做即时提示):条件组走 `validate_groups`,排序走 `validate_sorts`
pub fn validate(c: &FilterConditions) -> Result<(), String> {
    // 旧单值 sort 是只读兼容位:非法取值仍要拦(与 `validate_sorts` 的 sorts 检查同口径)
    if let Some(s) = c.sort.as_deref() {
        if s != "newest" && s != "oldest" {
            return Err("排序取值非法".into());
        }
    }
    validate_groups(c)?;
    validate_sorts(c)?;
    if let Some(g) = &c.group_by {
        validate_group_by(g)?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "filter_predicates_short_tests.rs"]
mod filter_predicates_short_tests;

#[cfg(test)]
#[path = "notes_filter_md_tests.rs"]
mod notes_filter_md_tests;

#[cfg(test)]
#[path = "notes_filter_relation_tests.rs"]
mod notes_filter_relation_tests;
