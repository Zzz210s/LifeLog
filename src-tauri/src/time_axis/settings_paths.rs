//! 三个 settings 键里的标签路径前缀改写(P0-4;spec §10.6 / E6):
//! `filter_current`(条件 / 排序 / 分组 / 表达式)、`ui.mru.tags`(`[{"id":路径,"count":n}]`)、
//! `ui.pinned.tags`(`["路径"]`)。前缀语义复用 [`rewrite_path`](筛选条件级联的同一份实现),
//! 段边界由显式 `/` 保证;不改时间路径的条目原样保留,坏 JSON 跳过(不动、不失败)。
use crate::db::repos::filter_rewrite::{rewrite_filter_paths, rewrite_path};
use crate::db::repos::settings;
use rusqlite::Connection;
use serde_json::Value;

/// 标签固定项(路径数组)
pub const PINNED_TAGS_KEY: &str = "ui.pinned.tags";
/// 标签 MRU(`[{"id":路径,"count":n}]`)
pub const MRU_TAGS_KEY: &str = "ui.mru.tags";

/// 就地改写三键里的路径前缀,返回实际变化的键名(供报告;空 = 一个字都没改)。
pub(crate) fn rewrite(conn: &Connection, old: &str, new: &str) -> rusqlite::Result<Vec<String>> {
    let mut changed = Vec::new();
    // filter_current:复用既有的条件对象级联(条件 / 排序 / 分组 / 表达式一次覆盖)
    let before = settings::get(conn, settings::FILTER_CURRENT_KEY)?;
    rewrite_filter_paths(conn, old, new)?;
    if settings::get(conn, settings::FILTER_CURRENT_KEY)? != before {
        changed.push(settings::FILTER_CURRENT_KEY.to_string());
    }
    for key in [MRU_TAGS_KEY, PINNED_TAGS_KEY] {
        if rewrite_json_paths(conn, key, old, new)? {
            changed.push(key.to_string());
        }
    }
    Ok(changed)
}

/// 两份 JSON 数组的路径字段改写:MRU 改每个对象的 `id`,固定项改每个字符串。
/// **只改路径字面量,不整体规范化**:其余字节(键顺序 / `count` / 缩进)原样保留;
/// 无变化 / 键缺失 / 坏 JSON 都不写。
fn rewrite_json_paths(
    conn: &Connection,
    key: &str,
    old: &str,
    new: &str,
) -> rusqlite::Result<bool> {
    let Some(raw) = settings::get(conn, key)? else {
        return Ok(false);
    };
    let Ok(mut value) = serde_json::from_str::<Value>(&raw) else {
        return Ok(false); // 坏 JSON:不动、不失败
    };
    let mut pairs: Vec<(String, String)> = Vec::new();
    if let Value::Array(items) = &mut value {
        for item in items.iter_mut() {
            match item {
                Value::String(path) => {
                    if let Some(next) = rewrite_path(path, old, new) {
                        pairs.push((path.clone(), next.clone()));
                        *path = next;
                    }
                }
                Value::Object(map) => {
                    if let Some(Value::String(path)) = map.get_mut("id") {
                        if let Some(next) = rewrite_path(path, old, new) {
                            pairs.push((path.clone(), next.clone()));
                            *path = next;
                        }
                    }
                }
                _ => {}
            }
        }
    }
    if pairs.is_empty() {
        return Ok(false);
    }
    // 只改路径字面量,不整体规范化(键顺序 / `count` 等其余字节原样);
    // 就地替换没能逐字命中全部字面量时回落到整体重序列化(内容仍正确)。
    let out = splice_literals(&raw, &pairs)
        .filter(|out| serde_json::from_str::<Value>(out).ok().as_ref() == Some(&value))
        .unwrap_or_else(|| serde_json::to_string(&value).unwrap_or(raw));
    settings::set(conn, key, &out)?;
    Ok(true)
}

/// 按 JSON 字符串字面量就地替换(返回 None = 有字面量没被逐字命中,调用方应回落)
fn splice_literals(raw: &str, pairs: &[(String, String)]) -> Option<String> {
    let mut out = raw.to_string();
    for (from, to) in pairs {
        let (needle, repl) = (json_literal(from), json_literal(to));
        if !out.contains(&needle) {
            return None;
        }
        out = out.replace(&needle, &repl);
    }
    Some(out)
}

/// `abc` -> `"abc"`(与 `serde_json` 同一套转义;中文不转义,与前端 `JSON.stringify` 一致)
fn json_literal(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| format!("\"{text}\""))
}
