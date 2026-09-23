//! 共享测试向量(仓库根 `fixtures/hotkey-spec.json`)的 Rust 侧断言。
//!
//! 这份 JSON 是两侧唯一真源:前端把 `cases` 喂给真实的 `normalizeParts`
//! (见 `src/shared/hotkey-match.test.ts`)、`mainKeys` 喂给 `hotkey-keys.ts` 的主键名表
//! (`src/shared/hotkey-keys.test.ts`);Rust 侧喂给真源实现 `hotkey_spec`。
//! T3 审查 Important-2:主键合法性/规范化名这条轴此前只有单侧,这里补上镜像 ——
//! 前端放行的键名必须能在插件解析器里落地(否则录制器写出的就是「按了没反应」的死键)。
//! `events` 段是 DOM 事件面,TS 独有,Rust 只断言它存在。
use crate::hotkey_spec::{check, validate};
use serde::Deserialize;

const HOTKEY_SPEC: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/hotkey-spec.json"
));

#[derive(Deserialize)]
struct Fixture {
    cases: Vec<Case>,
    #[serde(rename = "mainKeys")]
    main_keys: Vec<String>,
    events: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
struct Case {
    why: String,
    keys: Vec<String>,
    normalized: Option<String>,
}

fn fixture() -> Fixture {
    serde_json::from_str(HOTKEY_SPEC).expect("fixtures/hotkey-spec.json 必须是合法 JSON")
}

#[test]
fn fixture_hotkey_spec_is_well_formed() {
    let f = fixture();
    assert!(f.cases.len() >= 40, "cases 至少 40 条,实际 {}", f.cases.len());
    assert!(f.main_keys.len() >= 100, "mainKeys 至少 100 条,实际 {}", f.main_keys.len());
    assert!(f.events.len() >= 8, "events(TS 独有)至少 8 条,实际 {}", f.events.len());
    for c in &f.cases {
        assert!(!c.why.is_empty(), "每条 case 都要有 why");
        assert!(!c.keys.iter().any(|k| k.is_empty()), "{}:键名片段不能是空串", c.why);
    }
}

/// 每条 case:两侧判定逐条一致(Ok 必须等于 normalized,Err 必须对应 null)
#[test]
fn every_case_matches_rust_validate() {
    for c in fixture().cases {
        match (validate(&c.keys), c.normalized.as_deref()) {
            (Ok(got), Some(want)) => assert_eq!(got, want, "{}", c.why),
            (Err(reason), None) => assert!(!reason.is_empty(), "{}:错误原因不能为空", c.why),
            (Ok(got), None) => panic!("{}:Rust 接受 {got},向量说非法", c.why),
            (Err(reason), Some(want)) => panic!("{}:Rust 拒绝({reason}),向量要 {want}", c.why),
        }
    }
}

/// mainKeys:每个名字都是**规范名**且被插件解析器接受(TS 表与它逐条相等)
#[test]
fn every_main_key_name_is_canonical_and_accepted() {
    for name in fixture().main_keys {
        let once = check(&format!("ctrl+{name}")).unwrap_or_else(|e| panic!("{name}:{e}"));
        assert_eq!(once, format!("ctrl+{name}"), "{name} 不是规范名");
        // 幂等:规范名再喂回去结果不变(否则重启/重放会漂移)
        assert_eq!(check(&once).as_deref(), Ok(once.as_str()), "{name} 规范化不稳定");
    }
}

/// 单键规则钉在 F1-F24:mainKeys 里恰好 24 个功能键,其余单键一律拒绝
#[test]
fn single_key_rule_is_pinned_to_f1_f24() {
    let keys = fixture().main_keys;
    let function_keys: Vec<&String> = keys
        .iter()
        .filter(|n| n.strip_prefix('f').and_then(|d| d.parse::<u8>().ok()).is_some())
        .collect();
    assert_eq!(function_keys.len(), 24, "功能键应恰好 F1-F24");
    for name in keys {
        let allowed = name
            .strip_prefix('f')
            .and_then(|d| d.parse::<u8>().ok())
            .is_some_and(|n| (1..=24).contains(&n));
        assert_eq!(check(&name).is_ok(), allowed, "单键 {name} 的放行判定不符");
    }
}
