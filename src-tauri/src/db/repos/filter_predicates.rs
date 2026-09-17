//! 结构化条件与表达式共用的 SQL 谓词真源(标签 / 关键词)。
//! 只产出「固定谓词模板 + `?` 占位符」并把值按占位符次序推进 `args` —— 用户输入
//! 永不进入 SQL 文本(注入面为零)。`n` = notes 行别名,`t` = 标签行别名;
//! 每个谓词自带 EXISTS 子查询,彼此不共用别名实例。
//! 日期比较已整体取消(spec 2026-09-17 D2):谓词真源里不再有日期项。
use rusqlite::types::Value;

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
/// 正文/标签子串 LIKE。时间标签已是普通标签(D3),FTS 与 LIKE 两侧都一视同仁地
/// 参与关键词匹配,不再有"排除时间子树"的例外。
/// LIKE 通配符只出现在这条既有分支,标签路径匹配永不用。
pub(crate) fn keyword_predicate(k: &str, args: &mut Vec<Value>) -> String {
    if k.chars().count() >= 3 {
        args.push(Value::Text(format!("\"{}\"*", k.replace('"', "\"\""))));
        "n.id IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?)".to_string()
    } else {
        let pat = format!("%{k}%");
        args.push(Value::Text(pat.clone()));
        args.push(Value::Text(pat));
        "(n.content LIKE ? OR EXISTS (SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id \
         WHERE l.target_type = 'note' AND l.target_id = n.id AND t.path LIKE ?))"
            .to_string()
    }
}
