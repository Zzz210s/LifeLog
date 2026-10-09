//! 共享测试向量 `fixtures/entity-link-targets.json` 的 Rust 侧断言(spec §5.1 / P5):
//! 唯一匹配键 = `entity_key(meta)`(首行归一化),同键取 `id` 最小;不再有「标签优先 / 笔记优先」。
//! 前端 `src/shared/entity-link-targets.test.ts` 读同一份文件跑 `resolveLinkTarget`;
//! 这里把向量灌进最小 `entities` 表,走**生产**的 `note_links::candidates` 取候选,再跑 `resolve_target`。
//! 另附一条升级回归守卫:链接目标切到实体裁决后,「标签 + 链接同篇」正文的解析三元组
//! 仍与冻结基线 `fixtures/upgrade-regression.baseline.json` 逐字节一致(spec §5.3)。
use crate::db::repos::note_links::{candidates, resolve_target};
use crate::upgrade_regression::{self, BaselineEntry, Case, SOURCE_FIXTURE};
use rusqlite::{params, Connection};
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

/// 一条候选实体:`meta` 是唯一真源(首行当归一化键),`path` 只是显示缓存、不参匹配
#[derive(Deserialize)]
struct Entity {
    id: i64,
    meta: String,
    #[serde(default)]
    #[allow(dead_code)]
    path: Option<String>,
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

/// 把向量灌进最小 `entities` 表,再用**生产的** `candidates()` 取值 —— 取键口径与写入/读取侧同一份
fn fixture_db(t: &Targets) -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch(
        "CREATE TABLE entities(id INTEGER PRIMARY KEY, meta TEXT NOT NULL DEFAULT '', path TEXT);",
    )
    .unwrap();
    for e in &t.entities {
        c.execute(
            "INSERT INTO entities(id, meta, path) VALUES(?1, ?2, ?3)",
            params![e.id, e.meta, e.path],
        )
        .unwrap();
    }
    c
}

/// ① 向量自身合法:`why` 非空、id 唯一、expect 引用的 id 都存在、必须覆盖「名字含 /」
#[test]
fn fixture_is_well_formed() {
    let t = fixture();
    assert!(t.cases.len() >= 12, "向量至少 12 条,实际 {}", t.cases.len());
    let mut ids: Vec<i64> = t.entities.iter().map(|e| e.id).collect();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), t.entities.len(), "实体 id 必须唯一");
    for (i, c) in t.cases.iter().enumerate() {
        assert!(!c.why.is_empty(), "第 {i} 条 why 为空");
        if let Some(id) = c.expect {
            assert!(ids.contains(&id), "第 {i} 条 expect={id} 不在实体表里:{:?}", c.why);
        }
    }
    assert!(
        t.cases.iter().any(|c| c.raw_title.contains('/')),
        "必须有一条「名字含 /」的用例"
    );
}

/// ② 逐条断言:裁决结果与向量声明一致
#[test]
fn resolution_matches_shared_fixture() {
    let t = fixture();
    let cands = candidates(&fixture_db(&t)).unwrap();
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

/// ③ 变异自证靶点:把取键改成读 `path` 后本用例变红(名字含 / 的实体按 meta 命中,不按 path)
#[test]
fn link_target_resolves_by_entity_key_not_path() {
    let c = fixture_db(&fixture());
    let cands = candidates(&c).unwrap();
    assert_eq!(resolve_target(&cands, "甲/乙", None), Some(112), "按 meta 首行命中");
    assert_eq!(
        resolve_target(&cands, "显示缓存/甲/乙", None),
        None,
        "path 只是显示缓存,不能当匹配键"
    );
}

/// ④ 变异自证靶点:去掉「同键取 id 最小」后本用例变红
#[test]
fn same_key_takes_smallest_id() {
    let c = fixture_db(&fixture());
    let cands = candidates(&c).unwrap();
    assert_eq!(resolve_target(&cands, "撞名", None), Some(104));
}

/// ⑤ 升级回归:标签与链接同篇的正文,解析三元组必须仍等于冻结基线
#[test]
fn parse_triple_is_frozen_for_link_and_tag_bodies() {
    let cases: Vec<Case> = serde_json::from_str(UPGRADE_CASES).expect("升级向量必须是合法 JSON 数组");
    let base: Vec<BaselineEntry> =
        serde_json::from_str(UPGRADE_BASELINE).expect("升级基线必须是合法 JSON 数组");
    let frozen: Vec<&BaselineEntry> = base.iter().filter(|e| e.source == SOURCE_FIXTURE).collect();
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
