//! 升级回归:当前解析实现 == 冻结基线(spec §5.3 / 计划 T0.2)。
//!
//! 向量与基线都是 `include_str!` 进来的仓库文件:`fixtures/upgrade-regression.json`
//! (公开语料)与 `fixtures/upgrade-regression.baseline.json`(迁移前生成、一旦提交即冻结)。
//! 断言只做「当前输出 == 基线」,不重新实现标签/链接语法。
use crate::upgrade_regression::{self, BaselineEntry, Case, COVERED_CATEGORIES, SOURCE_FIXTURE};
use std::collections::HashSet;

const CASES: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/upgrade-regression.json"
));
const BASELINE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/upgrade-regression.baseline.json"
));

fn cases() -> Vec<Case> {
    serde_json::from_str(CASES).expect("fixtures/upgrade-regression.json 必须是合法 JSON 数组")
}

fn baseline() -> Vec<BaselineEntry> {
    serde_json::from_str(BASELINE)
        .expect("fixtures/upgrade-regression.baseline.json 必须是合法 JSON 数组")
}

/// ① 向量自身合法(why 非空、正文不重复),且覆盖 7 个类别
#[test]
fn fixture_is_well_formed_and_covers_categories() {
    let cases = cases();
    assert!(cases.len() >= 30, "回归向量至少 30 条,实际 {}", cases.len());
    let mut seen = HashSet::new();
    for (i, c) in cases.iter().enumerate() {
        assert!(!c.why.is_empty(), "第 {i} 条 why 为空");
        assert!(seen.insert(c.content.clone()), "第 {i} 条正文重复:{:?}", c.why);
    }
    let hit: HashSet<&'static str> = cases
        .iter()
        .map(|c| {
            let (tags, links, ..) = upgrade_regression::parse_content(&c.content);
            upgrade_regression::categorize(&c.content, &tags, &links)
        })
        .collect();
    for name in COVERED_CATEGORIES {
        assert!(hit.contains(name), "回归向量缺少类别 {name}");
    }
}

/// ② 基线条数与向量一一对应(fixture 来源条目按同序排列)
#[test]
fn baseline_has_one_entry_per_case() {
    let fixture_entries = baseline()
        .into_iter()
        .filter(|e| e.source == SOURCE_FIXTURE)
        .count();
    assert_eq!(
        fixture_entries,
        cases().len(),
        "基线 fixture 条数与向量条数不一致(基线需重新生成)"
    );
}

/// ③~⑤ 逐条:标签集合 / 链接 raw_title 序列 / title / display_title / 摘要全部逐字节相等
#[test]
fn baseline_matches_current_parse() {
    let cases = cases();
    let entries = baseline();
    let fixture_entries: Vec<&BaselineEntry> =
        entries.iter().filter(|e| e.source == SOURCE_FIXTURE).collect();
    assert_eq!(fixture_entries.len(), cases.len(), "第 ② 条已覆盖,这里兜底");
    for (i, (c, e)) in cases.iter().zip(fixture_entries).enumerate() {
        let now = upgrade_regression::entry_from(&c.content, SOURCE_FIXTURE, &c.why);
        assert_eq!(now.content_sha256, e.content_sha256, "第 {i} 条正文摘要漂移:{:?}", c.why);
        assert_eq!(now.tags, e.tags, "第 {i} 条标签集合漂移:{:?}", c.why);
        assert_eq!(now.links, e.links, "第 {i} 条链接集合漂移:{:?}", c.why);
        assert_eq!(now.title, e.title, "第 {i} 条 title 漂移:{:?}", c.why);
        assert_eq!(now.display_title, e.display_title, "第 {i} 条 display_title 漂移:{:?}", c.why);
        assert_eq!(now.sha256, e.sha256, "第 {i} 条三元组摘要漂移:{:?}", c.why);
    }
}

/// ⑥ 基线不存正文、摘要自洽(sha256 必须能由三元组重算出来)
#[test]
fn baseline_is_content_free_and_self_consistent() {
    assert!(!BASELINE.contains("\"content\""), "基线不得含正文(只有 content_sha256)");
    for (i, e) in baseline().iter().enumerate() {
        assert!(!e.why.is_empty(), "第 {i} 条 why 为空");
        assert_eq!(e.content_sha256.len(), 64, "第 {i} 条 content_sha256 形态不对");
        let recomputed =
            upgrade_regression::triple_sha(&e.tags, &e.links, &e.title, &e.display_title);
        assert_eq!(recomputed, e.sha256, "第 {i} 条 sha256 与三元组不一致:{:?}", e.why);
    }
}
