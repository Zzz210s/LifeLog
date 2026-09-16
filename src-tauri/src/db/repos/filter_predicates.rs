//! 结构化条件与表达式共用的 SQL 谓词真源(标签 / 关键词 / 日期)。
//! 只产出「固定谓词模板 + `?` 占位符」并把值按占位符次序推进 `args` —— 用户输入
//! 永不进入 SQL 文本(注入面为零)。`n` = notes 行别名,`t` = 标签行别名;
//! 每个谓词自带 EXISTS 子查询,彼此不共用别名实例。
use rusqlite::types::Value;

use crate::expr::ast::DateOp;

/// 日期比较的左侧:先把路径截到日级长度再比(与 `length(?)` 各占一个位置参数)
const DAY_LEVEL_LHS: &str = "substr(t.path, 1, length(?))";

/// 标签路径谓词:`self_only` 为真只比本级(`t.path = ?`),否则「本级或 `path/` 前缀」
/// (`substr(path, 1, length(?) + 1) = ? || '/'`)。前缀一律 substr,禁 LIKE 通配符
/// (标签名可能含 `%`/`_`)。值只进参数向量,顺序与占位符一一对应。
pub(crate) fn tag_predicate(path: &str, self_only: bool, args: &mut Vec<Value>) -> String {
    args.push(Value::Text(path.to_string()));
    if self_only {
        "t.path = ?".to_string()
    } else {
        args.push(Value::Text(path.to_string()));
        args.push(Value::Text(path.to_string()));
        "t.path = ? OR substr(t.path, 1, length(?) + 1) = ? || '/'".to_string()
    }
}

/// `笔记 n 挂有满足 m 的标签` 的 EXISTS 包装;取反(排除标签、`NOT`)由调用方加 `NOT `
pub(crate) fn tag_exists(m: &str) -> String {
    format!(
        "EXISTS (SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id \
         WHERE l.target_type = 'note' AND l.target_id = n.id AND ({m}))"
    )
}

/// 关键词谓词:≥3 字符走 FTS(整串加引号 + 前缀星号,内部引号翻倍转义),否则退化
/// 正文/标签子串 LIKE。短词分支的标签侧同样排除时间子树 —— 时间由日期条件负责,
/// 搜「11」不得命中整段时期。LIKE 通配符只出现在这条既有分支,标签路径匹配永不用。
pub(crate) fn keyword_predicate(k: &str, args: &mut Vec<Value>) -> String {
    if k.chars().count() >= 3 {
        args.push(Value::Text(format!("\"{}\"*", k.replace('"', "\"\""))));
        "n.id IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?)".to_string()
    } else {
        let pat = format!("%{k}%");
        args.push(Value::Text(pat.clone()));
        args.push(Value::Text(pat));
        format!(
            "(n.content LIKE ? OR EXISTS (SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id \
             WHERE l.target_type = 'note' AND l.target_id = n.id AND NOT ({}) AND t.path LIKE ?))",
            crate::timetag::sql_in_time_subtree("t")
        )
    }
}

/// 日期条件(边界来自 [`crate::timetag::path_for_date`],即 `时间排序/<Y>/<M>/<D>`):
/// 比较该笔记的时间标签路径与日级边界(零填充,字典序即时间序,端点当天包含在内)。
/// 下界 `>=` 直接整串比较;`>`/`<`/`<=`/`=` 先把路径截到日级长度再比 —— 更深的路径
/// (`时间排序/Y/M/D/子级`)与当天同界,不截断则 `>`/`=` 会把当天判错。
/// 粗粒度时间标签(年/月级、裸根)没有日期,与 [`crate::timetag::sql_has_time_day`] 一致地
/// 不落入任何范围。日期非法(未经 validate)时给恒假条件:宁可查不到,也不放宽语义。
pub(crate) fn date_predicate(op: &DateOp, date: &str, args: &mut Vec<Value>) -> String {
    let Some(bound) = crate::timetag::path_for_date(date) else {
        return "0=1".to_string();
    };
    let (cmp, lhs, doubled) = match op {
        DateOp::Ge => (">=", "t.path", false),
        DateOp::Gt => (">", DAY_LEVEL_LHS, true),
        DateOp::Lt => ("<", DAY_LEVEL_LHS, true),
        DateOp::Le => ("<=", DAY_LEVEL_LHS, true),
        DateOp::Eq => ("=", DAY_LEVEL_LHS, true),
    };
    args.push(Value::Text(bound.clone()));
    if doubled {
        args.push(Value::Text(bound));
    }
    format!(
        "EXISTS (SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id \
         WHERE l.target_type = 'note' AND l.target_id = n.id AND {} AND {lhs} {cmp} ?)",
        crate::timetag::sql_has_time_day("t")
    )
}
