//! 编译测试(brief Step 1):只断言片段形态与参数个数,SQL 语义由库级测试交叉比对。
//! 关键词短词分支的「时间子树排除」按共用谓词的实际形态断言(与
//! `notes_filter_tests::short_keyword_like_branch_excludes_time_tags` 同一串)。
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
    assert_eq!(args.len(), 3);
    assert!(!sql.contains("工作"), "标签值不得进 SQL:{sql}");
}

#[test]
fn self_only_tag_uses_equality() {
    let (sql, args) = frag("#=工作");
    assert!(sql.contains("t.path = ?"), "{sql}");
    assert!(!sql.contains("substr"), "{sql}");
    assert_eq!(args.len(), 1);
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
    assert_eq!(sql.matches("EXISTS (").count(), 3, "{sql}");
    assert_eq!(args.len(), 9, "三个含子级标签各压 3 个参数");
}

#[test]
fn short_keyword_uses_like_and_excludes_time_tags_from_tag_side() {
    let (sql, args) = frag("复盘");
    assert!(sql.contains("n.content LIKE ?"), "{sql}");
    // 时间子树排除:与结构化短关键词共用同一串谓词(裸根也算时间子树)
    assert!(
        sql.contains(
            "AND NOT ((t.path = '时间排序' OR substr(t.path, 1, length('时间排序') + 1) = '时间排序/')) AND t.path LIKE ?"
        ),
        "{sql}"
    );
    assert!(!sql.contains("复盘"), "关键词值不得进 SQL:{sql}");
    assert_eq!(args.len(), 2);
}

#[test]
fn long_keyword_uses_fts() {
    let (sql, args) = frag("会议记录复盘");
    assert!(sql.contains("notes_fts MATCH ?"), "{sql}");
    assert_eq!(args.len(), 1);
}

#[test]
fn date_ge_compares_time_tag_path() {
    let (sql, args) = frag("date>=2026-09-01");
    assert!(sql.contains("t.path >= ?"), "{sql}");
    assert!(sql.contains("length(t.path) >= 15"), "须带日级时间标签判定:{sql}");
    assert_eq!(args[0], Value::Text("时间排序/2026/09/01".into()));
    assert_eq!(args.len(), 1);
}

/// `>`/`<`/`<=`/`=` 一律先截到日级长度再比:更深的路径(`时间排序/Y/M/D/子级`)与当天同界
#[test]
fn date_operators_use_day_level_lhs_except_ge() {
    for (src, want, n) in [
        ("date>2026-09-01", "substr(t.path, 1, length(?)) > ?", 2),
        ("date<2026-09-01", "substr(t.path, 1, length(?)) < ?", 2),
        ("date<=2026-09-01", "substr(t.path, 1, length(?)) <= ?", 2),
        ("date=2026-09-01", "substr(t.path, 1, length(?)) = ?", 2),
    ] {
        let (sql, args) = frag(src);
        assert!(sql.contains(want), "{src} -> {sql}");
        assert_eq!(args.len(), n, "{src}");
        assert!(args.iter().all(|v| *v == Value::Text("时间排序/2026/09/01".into())), "{src}");
    }
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
