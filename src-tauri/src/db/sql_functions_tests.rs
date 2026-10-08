//! `tag_plain` 的行为证明:逐条读共享向量 `fixtures/tag-label.json` 的 raw/plain 两列
//! (前端 `src/shared/tag-label.test.ts` 与 Rust `tag_label_tests` 读同一份文件),
//! 证明 SQL 函数与两侧解析**同源**——不是又写了一份 md 去符号实现。
//! 另读数:重复注册幂等、确定性标记(让 SQLite 能把它当成不随行变化的表达式)。
//! `entity_name` / `entity_key` 同样读共享向量 `fixtures/entity-meta.json`(前端
//! `src/shared/entity-meta.test.ts`),并与 Rust `links::display_title` / `title_of` 对照。
use super::{register, ENTITY_KEY_FN, ENTITY_NAME_FN, TAG_PLAIN_FN};
use rusqlite::Connection;
use serde::Deserialize;

const TAG_LABEL: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/tag-label.json"
));

#[derive(Deserialize)]
struct LabelCase {
    raw: String,
    plain: String,
}

fn conn() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    register(&c).unwrap();
    c
}

/// 逐条:SQL 侧的 `tag_plain(raw)` 必须等于向量里的 `plain`
#[test]
fn tag_plain_matches_the_shared_vectors() {
    let c = conn();
    let cases: Vec<LabelCase> =
        serde_json::from_str(TAG_LABEL).expect("fixtures/tag-label.json 必须是合法 JSON 数组");
    assert!(cases.len() >= 20, "共享向量至少 20 条,实际 {}", cases.len());
    let mut checked = 0;
    for case in &cases {
        let got: String = c
            .query_row(&format!("SELECT {TAG_PLAIN_FN}(?1)"), [&case.raw], |r| r.get(0))
            .unwrap();
        assert_eq!(got, case.plain, "tag_plain({:?}) 与共享向量不一致", case.raw);
        if case.raw != case.plain {
            checked += 1;
        }
    }
    assert!(checked >= 5, "得有条目真的去了 md 语法,否则这条用例没有意义");
}

/// 明确钉一条最关键的形态:祖先段带 md 注解的完整路径
#[test]
fn tag_plain_strips_the_ancestor_annotation() {
    let c = conn();
    let got: String = c
        .query_row(
            "SELECT tag_plain('地点/中国大陆/湖南省/[郴](chēn)州市/宜章县')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(got, "地点/中国大陆/湖南省/郴州市/宜章县");
}

/// 注册幂等(生产 open_with + 迁移 run/apply 会重复注册,不能报错)且标记为确定性。
/// `entity_name` / `entity_key` 也要 deterministic —— 它们会出现在索引/触发器表达式里。
#[test]
fn register_is_idempotent_and_deterministic() {
    let c = conn();
    register(&c).unwrap();
    register(&c).unwrap();
    // pragma_function_list 没有 deterministic 列:确定性编码在 flags 的第 11 位(2048)
    for name in [TAG_PLAIN_FN, ENTITY_NAME_FN, ENTITY_KEY_FN] {
        let flags: i64 = c
            .query_row(
                "SELECT flags FROM pragma_function_list WHERE name = ?1",
                [name],
                |r| r.get(0),
            )
            .unwrap();
        assert_ne!(flags & 2048, 0, "{name} 必须标 deterministic");
    }
}

/// 函数存在性:`entity_name` / `entity_key` 各注册一次,不能被漏掉或重名覆盖。
#[test]
fn entity_functions_are_registered_exactly_once() {
    let c = conn();
    for name in [ENTITY_NAME_FN, ENTITY_KEY_FN] {
        let n: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM pragma_function_list WHERE name = ?1 AND narg = 1",
                [name],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1, "{name} 必须恰好注册一次");
    }
}

const ENTITY_META: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/entity-meta.json"
));

#[derive(Deserialize)]
struct MetaFile {
    cases: Vec<MetaCase>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetaCase {
    name: String,
    meta: String,
    expect_name: String,
    expect_key: String,
}

/// SQL 侧 `entity_name` / `entity_key` 与共享向量 `fixtures/entity-meta.json` 逐值一致;
/// 同时与 Rust `links::display_title` / `links::title_of` 对照,证明 SQL 只是转发、没写第二份解析。
#[test]
fn entity_functions_match_the_shared_vectors() {
    let c = conn();
    let f: MetaFile = serde_json::from_str(ENTITY_META).expect("fixtures/entity-meta.json 合法");
    assert!(f.cases.len() >= 8, "共享向量至少 8 条,实际 {}", f.cases.len());
    for case in &f.cases {
        let (name, key): (String, String) = c
            .query_row(
                "SELECT entity_name(?1), entity_key(?1)",
                [&case.meta],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(name, case.expect_name, "向量「{}」的 entity_name 不符", case.name);
        assert_eq!(key, case.expect_key, "向量「{}」的 entity_key 不符", case.name);
        assert_eq!(name, crate::links::display_title(&case.meta), "SQL 与 Rust 名字口径必须同源");
        assert_eq!(key, crate::links::title_of(&case.meta), "SQL 与 Rust 键口径必须同源");
    }
}
