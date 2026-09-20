//! 近义候选(G4 spec §2 D8 / §5.3):补全列表里的**提示层**,绝不自动改写用户输入。
//! 判定用**叶子名**(路径末段)与词元比较,按档位排序:
//! ① 完全相同;② 互相包含(两者长度都 ≥2);③ 双方都是 ASCII 且长度 ≥4 时编辑距离 ≤1。
//! 同档按路径升序(确定性,与标签/别名项的路径序一致);与已返回的标签/别名候选按 path 去重
//! (标签/别名优先);上限 SIMILAR_MAX。纯函数零 IO:候选集合由调用方给出,见 query::all_tag_paths。
use std::collections::HashSet;

/// 相似候选条数上限(D8)
pub const SIMILAR_MAX: usize = 4;

/// 触发阈值:标签 + 别名候选占不满前端展示上限(8 条,见 src/input-bar/tag-complete.ts 的
/// COMPLETE_LIMIT)时才去补相似项 —— 下拉已被前缀命中占满时,相似项排在末尾必然被截掉,
/// 整表取候选只是白费;不足时才有空位展示提示。改动前端展示上限时这里必须同步。
pub const SIMILAR_TRIGGER: usize = 8;

/// 路径末段(叶子名)
fn leaf_name(path: &str) -> &str {
    match path.rfind('/') {
        Some(i) => &path[i + 1..],
        None => path,
    }
}

/// 相似档位(1/2/3 = ①②③,None = 不相似)。长度一律按**字符**数(CJK 与 ASCII 同权)。
fn similar_rank(leaf: &str, token: &str) -> Option<u8> {
    if leaf.is_empty() || token.is_empty() {
        return None;
    }
    if leaf == token {
        return Some(1);
    }
    let (ll, tl) = (leaf.chars().count(), token.chars().count());
    if ll >= 2 && tl >= 2 && (leaf.contains(token) || token.contains(leaf)) {
        return Some(2);
    }
    if ll >= 4 && tl >= 4 && leaf.is_ascii() && token.is_ascii() && ascii_dist_le1(leaf, token) {
        return Some(3);
    }
    None
}

/// 编辑距离是否 ≤1(两串已确认均为 ASCII,按字节比较即字符比较):
/// 长度差 >1 直接否;等长时允许一处不同;差 1 时长串去掉那个多余字符后必须等于短串。
fn ascii_dist_le1(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    match a.len().abs_diff(b.len()) {
        0 => a.iter().zip(b).filter(|(x, y)| x != y).count() <= 1,
        1 => {
            let (short, long) = if a.len() < b.len() { (a, b) } else { (b, a) };
            let mut i = 0;
            while i < short.len() && short[i] == long[i] {
                i += 1;
            }
            short[i..] == long[i + 1..]
        }
        _ => false,
    }
}

/// 从候选标签路径里挑出与词元近似的路径:按档位排序(同档按路径升序),
/// 跳过 `exclude`(已返回的标签/别名)与重复路径,最多 `limit` 条。
pub fn similar_paths(
    tags: &[String],
    token: &str,
    exclude: &HashSet<String>,
    limit: usize,
) -> Vec<String> {
    let mut hits: Vec<(u8, &str)> = Vec::new();
    for path in tags {
        if exclude.contains(path.as_str()) {
            continue;
        }
        if let Some(rank) = similar_rank(leaf_name(path), token) {
            hits.push((rank, path.as_str()));
        }
    }
    hits.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(b.1)));
    let mut seen: HashSet<&str> = HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for (_, path) in hits {
        if seen.insert(path) {
            out.push(path.to_string());
        }
        if out.len() >= limit {
            break;
        }
    }
    out
}
