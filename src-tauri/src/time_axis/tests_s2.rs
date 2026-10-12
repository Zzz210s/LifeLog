//! S2 `created_at` 修复单测(内存 v31 夹具):命中取值、无日标签不动、非法日期拒绝、幂等、只动一列、
//! 多日标签取最早。夹具与助手见 `tests_support`。
use super::s2_created_at;
use super::tests_support::{count, db, note_with_tag, note_with_tags};
use rusqlite::{params, Connection};

fn created(c: &Connection, id: i64) -> String {
    c.query_row("SELECT created_at FROM points WHERE id = ?1", [id], |r| {
        r.get(0)
    })
    .unwrap()
}

fn set_created(c: &Connection, id: i64, value: &str) {
    c.execute(
        "UPDATE points SET created_at = ?1 WHERE id = ?2",
        params![value, id],
    )
    .unwrap();
}

fn id_of(c: &Connection, meta: &str) -> i64 {
    c.query_row("SELECT id FROM points WHERE meta = ?1", [meta], |r| {
        r.get(0)
    })
    .unwrap()
}

/// 逐值摘要(排序后拼接):用于证明「只动 created_at」时其它列逐值不变
fn digest(c: &Connection, sql: &str) -> String {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

const POINTS_DIGEST: &str = "SELECT group_concat(id || '|' || meta || '|' || COALESCE(path,'-')
  || '|' || COALESCE(parent_id,-1) || '|' || is_cited, char(10)) FROM
  (SELECT * FROM points ORDER BY id)";
const LINES_DIGEST: &str =
    "SELECT group_concat(from_id || '|' || to_id || '|' || COALESCE(name_id,-1),
  char(10)) FROM (SELECT * FROM lines ORDER BY from_id, to_id, COALESCE(name_id,-1))";

/// 命中篇:不一致的改成 `<日> 00:00:00`;已一致者归零时分秒;无日标签者不动
#[test]
fn s2_sets_created_at_to_day_tag_midnight() {
    let mut c = db();
    note_with_tag(&mut c, "时间/2026/10/05", "v1 十月五日");
    note_with_tag(&mut c, "时间/日期/2026/09/12", "v2 九月十二");
    note_with_tag(&mut c, "时间/出版年份/1994", "出版年不动");
    let (a, b, d) = (
        id_of(&c, "v1 十月五日"),
        id_of(&c, "v2 九月十二"),
        id_of(&c, "出版年不动"),
    );
    set_created(&c, a, "2026-09-17 00:15:12");
    set_created(&c, b, "2026-09-12 08:30:00");
    set_created(&c, d, "2026-09-17 00:15:12");

    let plan = s2_created_at::plan(&c).unwrap();
    assert_eq!(plan.hits.len(), 2, "两篇日标签笔记命中");
    assert!(plan.bad.is_empty());
    assert_eq!(plan.untouched, 1, "出版年份笔记无日标签");

    let report = s2_created_at::apply(&mut c, &plan).unwrap();
    assert!(report.iter().any(|l| l.contains("自对账")), "{report:?}");
    assert_eq!(created(&c, a), "2026-10-05 00:00:00");
    assert_eq!(
        created(&c, b),
        "2026-09-12 00:00:00",
        "本已一致者时分秒归零"
    );
    assert_eq!(created(&c, d), "2026-09-17 00:15:12", "出版年份笔记零接触");
}

/// 无日标签的笔记(含只带 `时间/出版年份/*` 的)逐字节不变
#[test]
fn s2_leaves_notes_without_day_tag_untouched() {
    let mut c = db();
    note_with_tag(&mut c, "时间/2026/10/05", "有日标签");
    note_with_tag(&mut c, "时间/出版年份/1994", "只带出版年");
    note_with_tag(&mut c, "电影", "非时间标签");
    note_with_tags(&mut c, &[], "完全无标签");
    let mut before = Vec::new();
    for meta in ["只带出版年", "非时间标签", "完全无标签"] {
        let id = id_of(&c, meta);
        set_created(&c, id, "2026-09-17 00:15:12");
        before.push((id, created(&c, id)));
    }

    let plan = s2_created_at::plan(&c).unwrap();
    assert_eq!(plan.hits.len(), 1);
    assert_eq!(plan.untouched, 3);
    s2_created_at::apply(&mut c, &plan).unwrap();
    for (id, old) in before {
        assert_eq!(
            created(&c, id),
            old,
            "无日标签笔记 created_at 必须逐字节不变"
        );
    }
}

/// 日标签路径拼不出合法日期 -> 拒绝 apply(码 2),库零变化
#[test]
fn s2_refuses_invalid_day_path() {
    let mut c = db();
    note_with_tag(&mut c, "时间/日期/2026/13/01", "十三月");
    let before = digest(&c, POINTS_DIGEST);
    let plan = s2_created_at::plan(&c).unwrap();
    assert_eq!(plan.bad.len(), 1, "13 月必须被判为非法日期");
    assert!(plan.bad[0].path.contains("2026/13/01"));
    let err = s2_created_at::apply(&mut c, &plan).unwrap_err();
    assert_eq!(err.code, 2, "{}", err.message);
    assert_eq!(digest(&c, POINTS_DIGEST), before, "拒绝时库零变化");
}

/// 幂等:连跑两次结果相同(第二次全部是「日期不变」,零实际变化)
#[test]
fn s2_is_idempotent() {
    let mut c = db();
    note_with_tag(&mut c, "时间/2026/10/05", "十月五日");
    note_with_tag(&mut c, "时间/日期/2025/08/01", "二〇二五");
    let first = s2_created_at::plan(&c).unwrap();
    assert_eq!(first.hits.len(), 2);
    s2_created_at::apply(&mut c, &first).unwrap();
    let (a, b) = (id_of(&c, "十月五日"), id_of(&c, "二〇二五"));
    let snap = (created(&c, a), created(&c, b));

    let second = s2_created_at::plan(&c).unwrap();
    let report = s2_created_at::apply(&mut c, &second).unwrap();
    assert!(
        report[0].contains("日期不变 2"),
        "第二次两条命中都应已是 00:00:00:{report:?}"
    );
    assert!(report[1].contains("命中 0 行实际有变"), "{report:?}");
    assert_eq!((created(&c, a), created(&c, b)), snap);
}

/// 只动一个列:`points`(除 created_at)/`lines`/`points_fts`/闭包/信息流默认筛选逐值相同
#[test]
fn s2_touches_only_created_at() {
    let mut c = db();
    note_with_tag(&mut c, "时间/2026/10/05", "十月五日");
    note_with_tag(&mut c, "时间/日期/2026/09/12", "九月十二");
    let before_points = digest(&c, POINTS_DIGEST);
    let before_lines = digest(&c, LINES_DIGEST);
    let before_fts = digest(
        &c,
        "SELECT group_concat(paths, char(10)) FROM (SELECT * FROM points_fts ORDER BY rowid)",
    );
    let before = s2_created_at::readings(&c).unwrap();

    let plan = s2_created_at::plan(&c).unwrap();
    s2_created_at::apply(&mut c, &plan).unwrap();

    assert_eq!(digest(&c, POINTS_DIGEST), before_points);
    assert_eq!(digest(&c, LINES_DIGEST), before_lines);
    assert_eq!(
        digest(
            &c,
            "SELECT group_concat(paths, char(10)) FROM (SELECT * FROM points_fts ORDER BY rowid)"
        ),
        before_fts
    );
    assert_eq!(s2_created_at::readings(&c).unwrap(), before);
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM points WHERE path IS NOT NULL"),
        before.tree
    );
}

/// 一篇多日标签:取最早一天(真库 0 篇;spec §7 未定,本实现拍板为最早日)
#[test]
fn s2_multi_day_tag_takes_earliest_day() {
    let mut c = db();
    note_with_tags(
        &mut c,
        &["时间/日期/2026/10/05", "时间/2026/09/12"],
        "跨两天",
    );
    let id = id_of(&c, "跨两天");
    set_created(&c, id, "2026-09-17 00:15:12");
    let plan = s2_created_at::plan(&c).unwrap();
    assert_eq!(plan.multi.len(), 1, "多日标签笔记进多日清单");
    assert_eq!(
        plan.multi[0].1,
        vec!["2026-09-12".to_string(), "2026-10-05".to_string()]
    );
    s2_created_at::apply(&mut c, &plan).unwrap();
    assert_eq!(created(&c, id), "2026-09-12 00:00:00");
}

/// `--phase both` 可解析
#[test]
fn s2_phase_parses_both() {
    use super::Phase;
    assert_eq!(Phase::parse("both"), Some(Phase::Both));
    assert_eq!(Phase::parse("created-at"), Some(Phase::CreatedAt));
    assert_eq!(Phase::Both.as_str(), "both");
}
