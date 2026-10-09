//! 结构化条件与表达式共用的 SQL 谓词真源(标签 / 关键词 / 在树内 / 单行)。
//! 只产出「固定谓词模板 + `?` 占位符」并把值按占位符次序推进 `args` —— 用户输入
//! 永不进入 SQL 文本(注入面为零)。`n` = 实体行别名(`entities` 的任意行),
//! `t` = 被 `edges(kind='link')` 指向的实体行别名;每个谓词自带 EXISTS 子查询,
//! 彼此不共用别名实例。迁后已无 `kind` 列:树内实体以 `path IS NOT NULL` 表达
//! (标签条件只比 `path`,树外实体 `path` 为 NULL 天然不命中)。
//! 日期比较已整体取消(spec 2026-09-17 D2):谓词真源里不再有日期项。
use rusqlite::types::Value;

use crate::db::repos::entities::closure::in_tree_predicate;

/// 标签路径谓词:`self_only` 为真只比本级(`t.path = ?`),否则「本级或 `path/` 前缀」
/// (`substr(path, 1, length(?) + 1) = ? || '/'`)。前缀一律 substr,禁 LIKE 通配符
/// (标签名可能含 `%`/`_`)。值只进参数向量,顺序与占位符一一对应。
///
/// 2026-10-05 携带(spec §4 S1、§5 口径表):若存在实体 A 携带 `path`
/// (`edges` 里 `kind='link'` 且指向该 path 实体),则 A 及其全部后代也参与命中 ——
/// 即 `t`(被引用的实体)落在某个携带者的子树内。仅本级 / 含子级两种模式都带这条
/// (它说的是「`path` 被谁继承」,与 `self_only` 无关)。命中集 =
/// 直接引用该实体 ∪ 携带它的实体子树,排除侧走同一份谓词(无黑洞)。
pub(crate) fn tag_predicate(path: &str, self_only: bool, args: &mut Vec<Value>) -> String {
    args.push(Value::Text(path.to_string()));
    let direct = if self_only {
        "t.path = ?".to_string()
    } else {
        args.push(Value::Text(path.to_string()));
        args.push(Value::Text(path.to_string()));
        "t.path = ? OR substr(t.path, 1, length(?) + 1) = ? || '/'".to_string()
    };
    format!("({direct}) OR {}", carry_predicate(path, args))
}

/// 「`t` 落在某个携带 `path` 的实体子树内」:先把「携带者子树的实体 id」物化成一个
/// 集合,再用 `t.id IN (...)` 做成员判定。集合子查询**不引用 `t`/`n`**,SQLite 只求值
/// 一次(QUERY PLAN 里是 `LIST SUBQUERY`);物化集合与携带行数近乎无关。
/// 迁后 `relation` 边并入 `link`:携带者 `ca` 是树内实体(范本只在树里改名,
/// 树外实体 `path` 为 NULL,`d.path = ca.path` 恒不成立),故无需再按 kind 过滤;
/// 比较 `d.path`/`ca.path` 已隐式要求两端都是树内实体。前缀用 substr、边界靠显式 `/`。
///
/// 关系条件(原「类型条件」,设计 2026-10-06 §2 / §10 R10b)直接复用本谓词:迁移 022 把
/// `'type'` 边并入 `'tag'`、028 起老 `tagging`/`relation`/`link` 全并入 `link`,
/// 「R 被哪些实体指向」与「谁携带 R」本就是同一件事。
pub(crate) fn carry_predicate(path: &str, args: &mut Vec<Value>) -> String {
    args.push(Value::Text(path.to_string())); // 定位被携带/被指向实体(按 path 取 id)
    "t.id IN (SELECT d.id FROM entities d \
     JOIN edges cl ON cl.kind = 'link' \
     JOIN entities ca ON ca.id = cl.source_id \
     WHERE cl.target_id IN (SELECT id FROM entities WHERE path = ?) \
       AND ca.path IS NOT NULL \
       AND (d.path = ca.path OR substr(d.path, 1, length(ca.path) + 1) = ca.path || '/'))"
        .to_string()
}

/// `实体 n 引用有满足 m 的实体` 的 EXISTS 包装;取反(排除标签、`NOT`)由调用方加 `NOT `
pub(crate) fn tag_exists(m: &str) -> String {
    format!(
        "EXISTS (SELECT 1 FROM edges l JOIN entities t ON t.id = l.target_id \
         WHERE l.kind = 'link' AND l.source_id = n.id AND ({m}))"
    )
}

/// 关键词谓词:≥3 字符走 FTS(整串加引号 + 前缀星号,内部引号翻倍转义),否则退化
/// 正文/被引用实体子串 LIKE。时间标签已是普通标签(D3),FTS 与 LIKE 两侧都一视同仁地
/// 参与关键词匹配,不再有"排除时间子树"的例外。
/// LIKE 通配符只出现在这条既有分支,标签路径匹配永不用。
/// <3 字退化同时比 `t.path` 与 `t.meta`(spec §8.3):trigram 对 2 字命中不到,而名字是
/// `meta` 首行、路径是完整路径(028 起 `name`/`content` 合并为 `meta`)。
pub(crate) fn keyword_predicate(k: &str, args: &mut Vec<Value>) -> String {
    if k.chars().count() >= 3 {
        args.push(Value::Text(format!("\"{}\"*", k.replace('"', "\"\""))));
        "n.id IN (SELECT rowid FROM entities_fts WHERE entities_fts MATCH ?)".to_string()
    } else {
        let pat = format!("%{k}%");
        args.push(Value::Text(pat.clone()));
        args.push(Value::Text(pat.clone()));
        args.push(Value::Text(pat));
        "(n.meta LIKE ? OR EXISTS (SELECT 1 FROM edges l JOIN entities t ON t.id = l.target_id \
         WHERE l.kind = 'link' AND l.source_id = n.id AND (t.path LIKE ? OR t.meta LIKE ?)))"
            .to_string()
    }
}

/// 「在树内 / 不在树内」谓词(spec §4.1 / §10-P2):判定取 §3.3 渲染闭包
/// ([`in_tree_predicate`]),**不是**裸 `is_cited`。合法值 `in` / `out`,非法返回 `None`。
pub(crate) fn tree_membership_predicate(value: &str) -> Option<String> {
    let p = in_tree_predicate("n");
    match value {
        "in" => Some(p),
        "out" => Some(format!("NOT ({p})")),
        _ => None,
    }
}

/// 「单行 / 多行」谓词(spec §4.1 / §10-P2):`meta` 不含换行(`char(10)`)= 单行。
/// 合法值 `single` / `multi`,非法返回 `None`。
pub(crate) fn single_line_predicate(value: &str) -> Option<String> {
    match value {
        "single" => Some("instr(n.meta, char(10)) = 0".to_string()),
        "multi" => Some("instr(n.meta, char(10)) > 0".to_string()),
        _ => None,
    }
}
