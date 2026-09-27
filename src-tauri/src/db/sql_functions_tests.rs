//! `tag_plain` 的行为证明:逐条读共享向量 `fixtures/tag-label.json` 的 raw/plain 两列
//! (前端 `src/shared/tag-label.test.ts` 与 Rust `tag_label_tests` 读同一份文件),
//! 证明 SQL 函数与两侧解析**同源**——不是又写了一份 md 去符号实现。
//! 另读数:重复注册幂等、确定性标记(让 SQLite 能把它当成不随行变化的表达式)。
use super::{register, TAG_PLAIN_FN};
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

/// 注册幂等(生产 open_with + 迁移 run/apply 会重复注册,不能报错)且标记为确定性
#[test]
fn register_is_idempotent_and_deterministic() {
    let c = conn();
    register(&c).unwrap();
    register(&c).unwrap();
    // pragma_function_list 没有 deterministic 列:确定性编码在 flags 的第 11 位(2048)
    let flags: i64 = c
        .query_row(
            "SELECT flags FROM pragma_function_list WHERE name = ?1",
            [TAG_PLAIN_FN],
            |r| r.get(0),
        )
        .unwrap();
    assert_ne!(flags & 2048, 0, "标 deterministic 才会被 SQLite 当常量表达式优化");
}
