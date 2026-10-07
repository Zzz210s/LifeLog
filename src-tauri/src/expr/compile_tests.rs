//! 编译测试(brief Step 1):只断言片段形态与参数个数,SQL 语义由库级测试交叉比对。
//! 关键词短词分支与 FTS 分支都收全部标签(D3:时间标签已是普通标签,不再有例外)。
use super::compile::compile;
use super::parser::parse;
use rusqlite::types::Value;

fn frag(src: &str) -> (String, Vec<Value>) {
    let mut args = Vec::new();
    let sql = compile(&parse(src).unwrap(), &mut args);
    (sql, args)
}

#[test]
fn tag_with_children_uses_substr_prefix_and_no_like() {
    let (sql, args) = frag("#工作/项目A");
    assert!(sql.contains("EXISTS"), "{sql}");
    assert!(sql.contains("substr(t.path, 1, length(?) + 1) = ? || '/'"), "{sql}");
    assert!(!sql.contains("LIKE"), "{sql}");
    assert_eq!(args.len(), 4, "含子级直接段 3 + 携带定位 1");
    assert!(!sql.contains("工作"), "标签值不得进 SQL:{sql}");
}

#[test]
fn self_only_tag_uses_equality() {
    let (sql, args) = frag("#=工作");
    assert!(sql.contains("(t.path = ?)"), "{sql}");
    // substr 只允许出现在携带段(携带者子树);直接段仍是等式
    assert!(!sql.contains("t.path = ? OR substr"), "{sql}");
    assert_eq!(args.len(), 2, "本级 1 + 携带定位 1");
}

#[test]
fn not_wraps_a_negated_exists() {
    let (sql, _) = frag("NOT #临时");
    assert!(sql.starts_with("NOT ("), "{sql}");
    assert!(sql.contains("EXISTS"), "{sql}");
}

#[test]
/// 括号直接映射成 SQL 括号:左子树是 OR 时,AND 的左侧整体被括号包住
/// (brief 此处写的是 `) AND (`;实际形态是 `) AND EXISTS (`,因为标签叶子直接以
/// `EXISTS (` 起手、不再多包一层括号 —— 内容语义一致,见任务报告的偏差说明)
fn or_and_parens_map_to_boolean_sql() {
    let (sql, args) = frag("(#a OR #b) AND #c");
    assert!(sql.starts_with("(("), "{sql}");
    assert!(sql.contains(" OR "), "{sql}");
    assert!(sql.contains(") AND EXISTS ("), "{sql}");
    // 每个标签叶子 = 一个外层 tagging 边 EXISTS;携带段已改成不相关的 `IN (SELECT ...)`
    // (一次物化标签 id 集合,不再贡献第二个相关 EXISTS;见 filter_predicates::carry_predicate)
    assert_eq!(sql.matches("EXISTS (").count(), 3, "{sql}");
    assert_eq!(
        sql.matches("t.id IN (SELECT d.id FROM entities d").count(),
        3,
        "三个标签各一段物化携带集合:{sql}"
    );
    assert_eq!(args.len(), 12, "三个含子级标签各压 4 个参数(直接 3 + 携带 1)");
}

#[test]
fn short_keyword_uses_like_on_content_and_tags() {
    let (sql, args) = frag("复盘");
    assert!(sql.contains("n.content LIKE ?"), "{sql}");
    assert!(sql.contains("t.path LIKE ?"), "标签侧同样参与匹配:{sql}");
    assert!(sql.contains("t.name LIKE ?"), "2 字标签名靠名字分支胞底(spec §4.1):{sql}");
    assert!(!sql.contains("时间排序"), "不再有时间子树例外:{sql}");
    assert!(!sql.contains("复盘"), "关键词值不得进 SQL:{sql}");
    assert_eq!(args.len(), 3);
}

#[test]
fn long_keyword_uses_fts() {
    let (sql, args) = frag("会议记录复盘");
    assert!(sql.contains("entities_fts MATCH ?"), "{sql}");
    assert_eq!(args.len(), 1);
}

/// 日期比较已取消(D2):编译层不再有日期项,解析阶段即被拦(中文报错)
#[test]
fn date_comparison_no_longer_parses() {
    let err = parse("date>=2026-09-01").unwrap_err();
    assert_eq!(err.message, "日期比较已取消,请用时间标签筛选");
}

/// 空短语不是关键词:恒假(不能退化成 LIKE '%%' 那样"匹配一切")
#[test]
fn empty_phrase_never_matches() {
    for src in [r#""""#, r#""   ""#] {
        let (sql, args) = frag(src);
        assert_eq!(sql, "0=1", "{src} -> {sql}");
        assert!(args.is_empty(), "{src}");
    }
}
