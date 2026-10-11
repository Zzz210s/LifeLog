//! S1 结构 / 幂等 / FTS 单测(内存 v31 夹具);夹具见 `tests_support`。
use super::s1_tree;
use super::tests_support::{apply, count, fixture, id_at, paths};

/// 主结构用例:年 / 月容器上提、同名整棵合并、中间层删除、引用关系不改、合并记录 +2
#[test]
fn s1_lifts_years_and_merges_same_name_containers() {
    let mut c = fixture();
    let pre = s1_tree::readings(&c).unwrap();
    let plan = s1_tree::plan(&c).unwrap();
    assert_eq!(plan.years.len(), 2, "两个年容器都要上提");
    assert_eq!(plan.merges, 2, "`2026` 年 + `2026/10` 月各一次同名整棵合并");
    assert_eq!(plan.deletes(), 3, "中间层 1 + 合并源 2");

    let report = s1_tree::apply(&mut c, &plan).unwrap();
    assert!(report[0].starts_with("十条对账"), "{report:?}");

    // 逐节点路径与 depth(年 3->2、月 4->3、日 5->4)
    assert_eq!(
        paths(&c),
        vec![
            ("时间".to_string(), 1),
            ("时间/2025".to_string(), 2),
            ("时间/2025/08".to_string(), 3),
            ("时间/2025/08/01".to_string(), 4),
            ("时间/2026".to_string(), 2),
            ("时间/2026/09".to_string(), 3),
            ("时间/2026/09/12".to_string(), 4),
            ("时间/2026/10".to_string(), 3),
            ("时间/2026/10/04".to_string(), 4),
            ("时间/2026/10/05".to_string(), 4),
        ]
    );
    // 无重复同名子级 + parent_id 与子级线一致(check 6/2 已由自对账覆盖,这里显式钉住关键三点)
    assert_eq!(
        count(
            &c,
            "SELECT COUNT(*) FROM (SELECT parent_id, entity_key(meta) k FROM points
               WHERE path IS NOT NULL GROUP BY 1, 2 HAVING COUNT(*) > 1)"
        ),
        0,
        "搬移后不得出现重复同名子级"
    );
    for (child, parent) in [
        ("时间/2025/08/01", "时间/2025/08"),
        ("时间/2026/10/04", "时间/2026/10"),
        ("时间/2026/10/05", "时间/2026/10"),
    ] {
        let (c_id, p_id) = (id_at(&c, child), id_at(&c, parent));
        assert_eq!(
            count(&c, &format!("SELECT COUNT(*) FROM lines WHERE name_id = 0 AND from_id = {p_id} AND to_id = {c_id}")),
            1,
            "{child} 的子级线"
        );
        assert_eq!(
            count(
                &c,
                &format!("SELECT COUNT(*) FROM points WHERE id = {c_id} AND parent_id = {p_id}")
            ),
            1,
            "{child} 的 parent_id"
        );
    }
    // 引用关系不改:四篇笔记仍在,各挂一个日节点;`时间/日期` 一个节点都不剩
    assert_eq!(
        count(
            &c,
            "SELECT COUNT(*) FROM points WHERE path LIKE '时间/日期%'"
        ),
        0
    );
    assert_eq!(
        count(
            &c,
            "SELECT COUNT(*) FROM points p WHERE p.path IS NULL AND p.id <> 0
               AND NOT EXISTS (SELECT 1 FROM lines n WHERE n.name_id = p.id)"
        ),
        4
    );
    assert_eq!(
        count(
            &c,
            "SELECT COUNT(DISTINCT e.from_id) FROM lines e JOIN points t ON t.id = e.to_id
              WHERE (e.name_id IS NULL OR e.name_id <> 0) AND t.path LIKE '时间/%/%/%'"
        ),
        4,
        "四篇笔记各有一条日标签线"
    );
    let post = s1_tree::readings(&c).unwrap();
    assert_eq!(post.points, pre.points - 3);
    assert_eq!(post.merge_log, pre.merge_log + 2);
}

/// 幂等:收敛后再跑零写入(退出 0)
#[test]
fn s1_is_idempotent_when_date_layer_absent() {
    let mut c = fixture();
    apply(&mut c);
    let after = paths(&c);
    let plan = s1_tree::plan(&c).unwrap();
    assert!(plan.already_done);
    assert_eq!(
        plan.describe(),
        vec!["无需处理:`时间/日期` 不存在(S1 已收敛)".to_string()]
    );
    assert_eq!(
        s1_tree::apply(&mut c, &plan).unwrap(),
        vec!["S1 已收敛(`时间/日期` 不存在),零写入".to_string()]
    );
    assert_eq!(paths(&c), after);
}

/// 收敛后 FTS 里不得残留 `时间/日期`,行数等于视图口径
#[test]
fn s1_rebuilds_fts_without_date_layer_paths() {
    let mut c = fixture();
    apply(&mut c);
    assert_eq!(
        count(
            &c,
            "SELECT COUNT(*) FROM points_fts WHERE paths LIKE '%时间/日期%'"
        ),
        0
    );
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM points_fts"),
        count(&c, "SELECT COUNT(*) FROM points_fts_src")
    );
}
