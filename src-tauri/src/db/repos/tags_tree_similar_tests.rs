//! 近义候选纯函数测试(G4 spec §2 D8,测试先行):三档规则、档位排序、去重、上限。
use super::similar::{similar_paths, SIMILAR_MAX};
use std::collections::HashSet;

fn tags(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

fn no_exclude() -> HashSet<String> {
    HashSet::new()
}

/// ① 叶子名与词元完全相同(路径可以带父级)
#[test]
fn rank1_same_leaf_name() {
    let cand = tags(&["追番/日漫", "工作"]);
    assert_eq!(
        similar_paths(&cand, "日漫", &no_exclude(), SIMILAR_MAX),
        vec!["追番/日漫"],
        "叶子名相同即命中,与父级路径无关"
    );
}

/// ② 互相包含:两个方向都算
#[test]
fn rank2_mutual_containment_both_directions() {
    // 词元包含叶子名
    assert_eq!(
        similar_paths(&tags(&["父/日漫"]), "日漫画", &no_exclude(), SIMILAR_MAX),
        vec!["父/日漫"]
    );
    // 叶子名包含词元
    assert_eq!(
        similar_paths(&tags(&["父/日漫画"]), "日漫", &no_exclude(), SIMILAR_MAX),
        vec!["父/日漫画"]
    );
}

#[test]
fn rank2_requires_two_chars_on_both_sides() {
    let cand = tags(&["父/日漫", "父/漫"]);
    assert!(
        similar_paths(&cand, "日", &no_exclude(), SIMILAR_MAX).is_empty(),
        "词元只有 1 字"
    );
    assert!(
        similar_paths(&cand, "漫日", &no_exclude(), SIMILAR_MAX).is_empty(),
        "叶子只有 1 字(且另一侧不互相包含)"
    );
}

/// ③ 双方都是 ASCII 且长度 ≥4 时编辑距离 ≤1(包含等长替换与差一个字符两种)
#[test]
fn rank3_ascii_edit_distance() {
    // 等长、单字符替换
    assert_eq!(
        similar_paths(&tags(&["父/githab", "父/gitlab"]), "github", &no_exclude(), SIMILAR_MAX),
        vec!["父/githab"]
    );
    // 差一个字符:候选比词元少一个(且不构成子串关系,故走 ③ 而非 ②)
    assert_eq!(
        similar_paths(&tags(&["父/githb"]), "github", &no_exclude(), SIMILAR_MAX),
        vec!["父/githb"]
    );
    // 长度差 2 不算
    assert!(
        similar_paths(&tags(&["父/gitx"]), "github", &no_exclude(), SIMILAR_MAX).is_empty()
    );
}

#[test]
fn rank3_only_for_ascii_and_min_length_four() {
    assert!(
        similar_paths(&tags(&["父/abc日"]), "abc月", &no_exclude(), SIMILAR_MAX).is_empty(),
        "非 ASCII 不适用编辑距离档"
    );
    assert!(
        similar_paths(&tags(&["父/gib"]), "gith", &no_exclude(), SIMILAR_MAX).is_empty(),
        "长度 <4 不适用编辑距离档(且不构成包含关系)"
    );
}

/// 档位排序:① 全部在前,其次 ②,最后 ③;同档按路径升序
#[test]
fn ordered_by_rank_then_path() {
    let cand = tags(&["b日漫", "日漫", "a日漫", "父/日漫x"]);
    assert_eq!(
        similar_paths(&cand, "日漫", &no_exclude(), SIMILAR_MAX),
        vec!["日漫", "a日漫", "b日漫", "父/日漫x"],
        "① 日漫 之后是 ② 的三个,同档按路径升序"
    );
}

#[test]
fn rank3_comes_after_rank2() {
    let cand = tags(&["githab", "githubx", "github"]);
    assert_eq!(
        similar_paths(&cand, "github", &no_exclude(), SIMILAR_MAX),
        vec!["github", "githubx", "githab"],
        "① 相同 -> ② 包含 -> ③ 编辑距离"
    );
}

/// 去重:exclude 里的路径(已作为标签/别名返回)与候选集合内的重复路径都不出现
#[test]
fn dedupes_excluded_and_repeated_paths() {
    let cand = tags(&["日漫x", "日漫x", "日漫y"]);
    let exclude: HashSet<String> = ["日漫x".to_string()].into_iter().collect();
    assert_eq!(similar_paths(&cand, "日漫", &exclude, SIMILAR_MAX), vec!["日漫y"]);

    let cand2 = tags(&["日漫y", "日漫y"]);
    assert_eq!(similar_paths(&cand2, "日漫", &no_exclude(), SIMILAR_MAX), vec!["日漫y"]);
}

/// 上限:最多 SIMILAR_MAX 条
#[test]
fn respects_limit() {
    let cand = tags(&["父/日漫A", "父/日漫B", "父/日漫C", "父/日漫D", "父/日漫E"]);
    let out = similar_paths(&cand, "日漫", &no_exclude(), SIMILAR_MAX);
    assert_eq!(out.len(), SIMILAR_MAX);
    assert_eq!(out, vec!["父/日漫A", "父/日漫B", "父/日漫C", "父/日漫D"]);
}

/// 空词元(刚敲下 #)与空候选集合都不产生相似项
#[test]
fn empty_token_matches_nothing() {
    let cand = tags(&["日漫", "工作"]);
    assert!(similar_paths(&cand, "", &no_exclude(), SIMILAR_MAX).is_empty());
    assert!(similar_paths(&[], "日漫", &no_exclude(), SIMILAR_MAX).is_empty());
}
