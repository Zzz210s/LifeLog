//! 补全候选池的模糊扩展(A6a):路径前缀之外的「子串 + 子序列」档。
//!
//! 为什么需要:输入栏候选池原先只有后端 `complete` 的**路径前缀**命中,而前端共享打分器
//! (`fuzzy-score`,与主窗 `#` 标签 provider 同源)的命中口径是**子序列**。`#项A` 的目标
//! `工作/项目A` 里「项」「A」不相邻,既不是前缀也不是子串,根本进不了候选池 —— 打分器再强
//! 也无从排。本模块只做**候选池扩展**(粗筛,口径与打分器一致,不漏不多),排序与高亮仍归前端。
//!
//! 与近义档(`similar.rs`)的边界:会被近义档接管的路径(叶子名互相包含 / ASCII 编辑距离 ≤1)
//! 不进本档,留给 kind="similar" 的提示语义,避免扩展档把既有的 G4 契约顶掉。
use super::super::similar::is_similar_candidate;
use super::super::COMPLETE_LIMIT;
use rusqlite::Connection;
use std::collections::HashSet;

/// 补全候选池的模糊扩展:返回**非前缀**命中(子串档在前、子序列档在后,各自按路径升序),
/// 上限 COMPLETE_LIMIT;`exclude` 是上游已给出的路径(前缀命中 / 别名项),不重复返回。
pub(super) fn fuzzy_paths(
    conn: &Connection,
    token: &str,
    exclude: &HashSet<String>,
) -> rusqlite::Result<Vec<String>> {
    if token.is_empty() {
        return Ok(Vec::new());
    }
    let mut substr: Vec<String> = Vec::new();
    let mut subseq: Vec<String> = Vec::new();
    for path in all_paths(conn)? {
        if exclude.contains(&path) || is_similar_candidate(&path, token) {
            continue;
        }
        if path.contains(token) {
            substr.push(path);
        } else if is_subsequence(token, &path) {
            subseq.push(path);
        }
    }
    substr.extend(subseq);
    substr.truncate(COMPLETE_LIMIT as usize);
    Ok(substr)
}

/// 全量标签路径(路径升序)。只在前缀 + 别名候选占不满展示上限时才被调用(见调用方),
/// 量级是标签总数(百级),不构成每击键都扫表的负担。
fn all_paths(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT path FROM tags ORDER BY path")?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
}

/// 词元是否为路径的**子序列**(字符按序出现即可;大小写不敏感,`/` 与 `\` 视同 ——
/// 与前端 `scoreFuzzy` 的匹配条件同一口径)。空词元恒 false。
fn is_subsequence(token: &str, path: &str) -> bool {
    let mut query = token.chars().flat_map(char::to_lowercase);
    let mut want = match query.next() {
        Some(c) => c,
        None => return false,
    };
    for cur in path.chars().flat_map(char::to_lowercase) {
        if cur == want || (is_sep(cur) && is_sep(want)) {
            match query.next() {
                Some(c) => want = c,
                None => return true,
            }
        }
    }
    false
}

fn is_sep(c: char) -> bool {
    c == '/' || c == '\\'
}
