//! 升级回归:当前实现现算 == 冻结基线(spec §7.5 / 计划 T3.5)。
//!
//! 形状 `{source, why, content, expect:{citations, title}}`:`citations` = 该条正文落下的
//! `edges(kind='link')` 目标实体 id(`[[ ]]` 与 `#` 同一种边,spec §5.2),`title` = `entity_name(meta)`。
//! 生成真源 = `upgrade_regression::baseline::build_fixture_baseline`(产品写路径 + 读回边),
//! 本文件只做「现算 == 冻结」与 legacy 对照,不再实现第二套语法。
//!
//! 老库升级用例(`v23 -> 28` / `v26 -> 28`)复用 `db::unify_meta_upgrade_tests` 的起点构造,不另写一份。
use crate::upgrade_regression::{
    self, baseline, BaselineEntry, Case, COVERED_CATEGORIES, LegacyEntry, SOURCE_FIXTURE,
};
use std::collections::HashSet;

const CASES: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/upgrade-regression.json"
));
const BASELINE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/upgrade-regression.baseline.json"
));
const LEGACY: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/upgrade-regression.baseline.legacy.json"
));

fn cases() -> Vec<Case> {
    serde_json::from_str(CASES).expect("fixtures/upgrade-regression.json 必须是合法 JSON 数组")
}

fn baseline_entries() -> Vec<BaselineEntry> {
    serde_json::from_str(BASELINE)
        .expect("fixtures/upgrade-regression.baseline.json 必须是合法 JSON 数组")
}

fn legacy_entries() -> Vec<LegacyEntry> {
    serde_json::from_str(LEGACY)
        .expect("fixtures/upgrade-regression.baseline.legacy.json 必须是合法 JSON 数组")
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

/// ② 基线条数与向量一一对应(同序)
#[test]
fn baseline_has_one_entry_per_case() {
    assert_eq!(
        baseline_entries().len(),
        cases().len(),
        "基线条数与向量条数不一致(基线需重新生成)"
    );
}

/// ③+④ 逐条:现算(fixture 语料当库走产品写路径)citations 与 title == 冻结基线
/// 变异自证靶点:把基线里任意一条的 `citations` 末位删掉,本用例变红
#[test]
fn baseline_matches_current_link_targets() {
    let cases = cases();
    let now = baseline::build_fixture_baseline(&cases).expect("内存库现算基线不应失败");
    let frozen = baseline_entries();
    assert_eq!(frozen.len(), cases.len(), "第 ② 条已覆盖,这里兜底");
    for (i, (c, e)) in cases.iter().zip(&frozen).enumerate() {
        assert_eq!(e.content, c.content, "第 {i} 条正文漂移:{:?}", c.why);
        assert_eq!(e.expect, now[i].expect, "第 {i} 条 citations/title 漂移:{:?}", c.why);
    }
}

/// ⑤ `title` == `entity_name(meta)`(独立走一遍标签剥离,不看生成器的中间值)
#[test]
fn baseline_titles_match_entity_name_of_stripped_body() {
    for (i, e) in baseline_entries().iter().enumerate() {
        let meta = crate::db::repos::notes::notes_parse::strip_tags(&e.content);
        assert_eq!(
            e.expect.title,
            crate::links::display_title(&meta),
            "第 {i} 条 title 与 entity_name(meta) 不一致:{:?}",
            e.why
        );
        assert!(e.expect.citations.iter().all(|id| *id > 0), "第 {i} 条 citations 含非法 id");
    }
}

/// ⑥ 旧基线文件仍可解析(对照用):legacy 的解析三元组与当前严格语法逐条一致
/// (`title` 含 `display_title` 的口径在 T3.5 改为 `entity_name(meta)`,见 diff 报告;
/// 这里只钉“语法未变”:严格抽出的标签路径与 `[[ ]]` raw_title 序列不变)
#[test]
fn legacy_baseline_is_parseable_and_syntax_unchanged() {
    let cases = cases();
    let legacy = legacy_entries();
    assert_eq!(legacy.len(), cases.len(), "legacy 基线条数与向量不一致");
    for (i, (c, old)) in cases.iter().zip(&legacy).enumerate() {
        assert_eq!(
            old.content_sha256,
            upgrade_regression::sha256_hex(c.content.as_bytes()),
            "第 {i} 条 legacy 正文摘要与向量不符:{:?}",
            c.why
        );
        let (tags, links, ..) = upgrade_regression::parse_content(&c.content);
        assert_eq!(old.tags, tags, "第 {i} 条标签集合漂移:{:?}", c.why);
        assert_eq!(old.links, links, "第 {i} 条链接 raw_title 序列漂移:{:?}", c.why);
        assert_eq!(
            old.sha256,
            upgrade_regression::triple_sha(&old.tags, &old.links, &old.title, &old.display_title),
            "第 {i} 条 legacy 摘要不自洽:{:?}",
            c.why
        );
    }
}

/// ⑦ 提交进仓库的基线只含 fixture 条目(公开仓库不收真库正文);legacy 形状仍不含正文
#[test]
fn committed_baseline_is_fixture_only_and_legacy_stays_content_free() {
    assert!(
        baseline_entries().iter().all(|e| e.source == SOURCE_FIXTURE),
        "仓库内基线不得含 db 抽样条目"
    );
    assert!(!LEGACY.contains("\"content\""), "legacy 基线不得含正文(只有 content_sha256)");
}
