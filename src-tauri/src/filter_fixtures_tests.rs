//! 共享测试向量(仓库根 `fixtures/filter-conditions.json`)的 Rust 侧断言。
//! 这份 JSON 是**两侧唯一真源**:前端把同样的条目喂给真实的校验函数
//! (见 `src/shared/fixtures.test.ts`:isValidTagPath / parseFilterJson / applyTagPick),
//! Rust 侧喂给真源实现(tags::parse_tag_path / notes_filter::validate / where_clause / expr::validate)。
//! 后端仍是唯一权威,这里只做"同一份向量两边判定一致"的漂移探测。
use crate::db::repos::notes::notes_filter::{oldest_first, validate, where_clause};
use crate::db::repos::notes::FilterConditions;
use crate::tags::parse_tag_path;
use serde::Deserialize;
use serde_json::Value;

const FILTER_CONDITIONS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/filter-conditions.json"
));

/// 一条向量(三种 kind 的字段并集;`why` 是文档字段,断言不读)
#[derive(Deserialize)]
struct Entry {
    kind: String,
    why: String,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    src: Option<String>,
    #[serde(default)]
    raw: Option<Value>,
    #[serde(default)]
    valid: Option<bool>,
    #[serde(default)]
    normalized: Option<Value>,
    #[serde(default)]
    empty: Option<bool>,
}

fn entries() -> Vec<Entry> {
    serde_json::from_str(FILTER_CONDITIONS)
        .expect("fixtures/filter-conditions.json 必须是合法 JSON 数组")
}

/// fixture 结构合法性 + 三类 kind 的覆盖数量
#[test]
fn fixture_filter_conditions_is_well_formed() {
    let all = entries();
    assert!(all.len() >= 20, "共享向量至少 20 条,实际 {}", all.len());
    for (i, e) in all.iter().enumerate() {
        match e.kind.as_str() {
            "tagPath" => {
                assert!(e.path.is_some() && e.valid.is_some(), "第 {i} 条:tagPath 缺字段");
            }
            "expr" => {
                let src = e.src.as_deref().expect("第 {i} 条:expr 缺 src");
                assert!(e.valid.is_some(), "第 {i} 条:expr 缺 valid");
                // 长度层由前端本地判(MAX_EXPR_CHARS),向量里不能有超长条目
                assert!(src.chars().count() <= crate::expr::MAX_LEN, "第 {i} 条:expr 超长");
            }
            "condition" => {
                assert!(e.raw.is_some(), "第 {i} 条:condition 缺 raw");
                if e.valid != Some(false) {
                    assert!(e.normalized.is_some(), "第 {i} 条:condition 缺 normalized");
                    assert!(e.empty.is_some(), "第 {i} 条:condition 缺 empty");
                }
            }
            other => panic!("第 {i} 条:未知 kind {other}"),
        }
    }
    let count = |k: &str| all.iter().filter(|e| e.kind == k).count();
    assert!(count("tagPath") >= 10 && count("condition") >= 8 && count("expr") >= 10);
}

/// tagPath:后端 parse_tag_path(与表达式词法共用)对每条向量判定一致
#[test]
fn tag_paths_match_shared_fixture() {
    for (i, e) in entries().iter().filter(|e| e.kind == "tagPath").enumerate() {
        let path = e.path.as_deref().unwrap();
        let valid = e.valid.unwrap();
        assert_eq!(
            parse_tag_path(path).is_some(),
            valid,
            "第 {i} 条标签路径判定不一致:{path:?}(为何:{})",
            e.why
        );
    }
}

/// expr:后端 expr::validate 对每条向量判定一致(前端只判长度,语义一律交给这里)
#[test]
fn expressions_match_shared_fixture() {
    for (i, e) in entries().iter().filter(|e| e.kind == "expr").enumerate() {
        let src = e.src.as_deref().unwrap();
        let valid = e.valid.unwrap();
        assert_eq!(
            crate::expr::validate(src).is_ok(),
            valid,
            "第 {i} 条表达式判定不一致:{src:?}(为何:{})",
            e.why
        );
    }
}

/// condition:反序列化(缺失补默认)+ 校验 + 收窄/空判定与 fixture 声明一致。
/// 说明:前端 parseFilterJson 对**整体非法**的对象回退 EMPTY_FILTER,后端不静默回退
/// (由 query_notes 前置 validate 拦截),故 valid=false 的条目只断言 validate 报错。
#[test]
fn conditions_match_shared_fixture() {
    for (i, e) in entries().iter().filter(|e| e.kind == "condition").enumerate() {
        let raw: FilterConditions = serde_json::from_value(e.raw.clone().unwrap())
            .unwrap_or_else(|err| panic!("第 {i} 条反序列化失败:{err}"));
        if e.valid == Some(false) {
            assert!(validate(&raw).is_err(), "第 {i} 条:非法条件对象必须被 validate 拦下");
            continue;
        }
        validate(&raw).unwrap_or_else(|err| panic!("第 {i} 条:validate 报错:{err}"));
        let n = e.normalized.as_ref().unwrap();
        assert_eq!(
            where_clause(&raw).0 == "1=1",
            e.empty.unwrap(),
            "第 {i} 条:空/收窄判定不一致(为何:{})",
            e.why
        );
        assert_eq!(oldest_first(&raw), n["sort"] == "oldest", "第 {i} 条排序不一致");
        let has_kw = raw
            .keyword
            .as_deref()
            .map(str::trim)
            .is_some_and(|k| !k.is_empty());
        assert_eq!(has_kw, !n["keyword"].is_null(), "第 {i} 条关键词有无不一致");
        assert_eq!(
            raw.expr.as_deref().map(str::trim).is_some_and(|s| !s.is_empty()),
            !n["expr"].is_null(),
            "第 {i} 条表达式有无不一致"
        );
        assert_eq!(
            raw.tag_presence.as_deref(),
            n["tagPresence"].as_str(),
            "第 {i} 条标签有无取值不一致"
        );
        // 标签列表:顺序保留、不去重(去重是选择器落笔的职责,后端不做第二套)
        for (key, list) in [("tags", &raw.tags), ("excludeTags", &raw.exclude_tags)] {
            let rows = n[key].as_array().unwrap();
            assert_eq!(list.len(), rows.len(), "第 {i} 条 {key} 条数不一致");
            for (j, t) in list.iter().enumerate() {
                assert_eq!(t.path, rows[j]["path"].as_str().unwrap(), "第 {i} 条 {key}[{j}] 路径");
                assert_eq!(
                    t.include_children,
                    rows[j]["includeChildren"].as_bool().unwrap(),
                    "第 {i} 条 {key}[{j}] includeChildren"
                );
            }
        }
    }
}
