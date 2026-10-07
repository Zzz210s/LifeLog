//! 共享测试向量 `fixtures/entity-link-targets.json` 的 Rust 侧断言(D6 `[[ ]]` 目标裁决)。
//! 这份 JSON 是两侧唯一真源:前端 `src/shared/entity-link-targets.test.ts` 读同一文件跑
//! `resolveLinkTarget`,这里跑 `note_links::resolve_target`,同一条用例两边都必须对上。
//! 另附一条升级回归守卫:链接目标切到实体裁决后,「标签 + 链接同篇」正文的解析三元组
//! 仍与冻结基线 `fixtures/upgrade-regression.baseline.json` 逐字节一致(spec §5.3)。
use crate::db::repos::note_links::{resolve_target, LinkCandidate, LinkKind};
use crate::links::{normalize_title, title_of};
use crate::upgrade_regression::{self, BaselineEntry, Case, SOURCE_FIXTURE};
use serde::Deserialize;

const FIXTURE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/entity-link-targets.json"
));
const UPGRADE_CASES: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/upgrade-regression.json"
));
const UPGRADE_BASELINE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/upgrade-regression.baseline.json"
));

/// 一条候选实体:标签给 `name`(单段名),笔记给 `content`(首行参与匹配)
#[derive(Deserialize)]
struct Entity {
    id: i64,
    kind: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    content: Option<String>,
}

#[derive(Deserialize)]
struct TargetCase {
    why: String,
    #[serde(rename = "rawTitle")]
    raw_title: String,
    #[serde(default)]
    exclude: Option<i64>,
    expect: Option<i64>,
}

#[derive(Deserialize)]
struct Targets {
    entities: Vec<Entity>,
    cases: Vec<TargetCase>,
}

fn fixture() -> Targets {
    serde_json::from_str(FIXTURE).expect("fixtures/entity-link-targets.json 必须是合法 JSON 对象")
}

/// 与产品写入/读取侧同一套归一化:标签用 `normalize_title(name)`,笔记用 `title_of(content)`
fn candidates(t: &Targets) -> Vec<LinkCandidate> {
    t.entities
        .iter()
        .map(|e| {
            let (kind, key) = if e.kind == "tag" {
                (LinkKind::Tag, normalize_title(e.name.as_deref().unwrap_or("")))
            } else {
                (LinkKind::Note, title_of(e.content.as_deref().unwrap_or("")))
            };
            LinkCandidate { id: e.id, kind, key }
        })
        .collect()
}

/// ① 向量自身合法:`why` 非空、expect 引用的 id 都存在、覆盖标签优先这一类
#[test]
fn fixture_is_well_formed() {
    let t = fixture();
    assert!(t.cases.len() >= 10, "D6 向量至少 10 条,实际 {}", t.cases.len());
    let ids: Vec<i64> = t.entities.iter().map(|e| e.id).collect();
    for (i, c) in t.cases.iter().enumerate() {
        assert!(!c.why.is_empty(), "第 {i} 条 why 为空");
        if let Some(id) = c.expect {
            assert!(ids.contains(&id), "第 {i} 条 expect={id} 不在实体表里:{:?}", c.why);
        }
    }
    assert!(
        t.cases.iter().any(|c| c.expect == Some(1_000_000_003)),
        "必须有一条「标签优先于笔记」的用例"
    );
}

/// ② 逐条断言:裁决结果与向量声明一致
#[test]
fn resolution_matches_shared_fixture() {
    let t = fixture();
    let cands = candidates(&t);
    for (i, c) in t.cases.iter().enumerate() {
        assert_eq!(
            resolve_target(&cands, &c.raw_title, c.exclude),
            c.expect,
            "第 {i} 条裁决不一致({}):rawTitle={:?} exclude={:?}",
            c.why,
            c.raw_title,
            c.exclude
        );
    }
}

/// ③ 变异自证靶点:去掉「标签优先」后本用例变红
#[test]
fn tag_wins_over_note_on_same_name() {
    let cands = vec![
        LinkCandidate { id: 4, kind: LinkKind::Note, key: "撞名".to_string() },
        LinkCandidate { id: 1_000_000_003, kind: LinkKind::Tag, key: "撞名".to_string() },
    ];
    assert_eq!(resolve_target(&cands, "撞名", None), Some(1_000_000_003));
}

/// ④ 升级回归:标签与链接同篇的正文,解析三元组必须仍等于冻结基线
#[test]
fn parse_triple_is_frozen_for_link_and_tag_bodies() {
    let cases: Vec<Case> = serde_json::from_str(UPGRADE_CASES).expect("升级向量必须是合法 JSON 数组");
    let base: Vec<BaselineEntry> =
        serde_json::from_str(UPGRADE_BASELINE).expect("升级基线必须是合法 JSON 数组");
    let frozen: Vec<&BaselineEntry> =
        base.iter().filter(|e| e.source == SOURCE_FIXTURE).collect();
    assert_eq!(frozen.len(), cases.len(), "基线条数与向量不一致");
    let mut checked = 0;
    for (c, e) in cases.iter().zip(frozen) {
        if !c.content.contains("[[") || !c.content.contains('#') {
            continue;
        }
        let now = upgrade_regression::entry_from(&c.content, SOURCE_FIXTURE, &c.why);
        assert_eq!(now.links, e.links, "链接序列漂移:{:?}", c.why);
        assert_eq!(now.tags, e.tags, "标签集合漂移:{:?}", c.why);
        assert_eq!(now.title, e.title, "title 漂移:{:?}", c.why);
        assert_eq!(now.display_title, e.display_title, "display_title 漂移:{:?}", c.why);
        checked += 1;
    }
    assert!(checked >= 3, "至少覆盖 3 条「标签 + 链接同篇」的冻结正文,实际 {checked}");
}
