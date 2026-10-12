//! S1 事务内自对账(自 s1_tree.rs 拆出以守 200 行上限):十条对账 + E1–E6 等价性。
//! 任一不满足 -> 退出码 3,调用方回滚整个事务(不会留下半收敛的库)。
use super::s1_sql::{check, map_set, note_tags, readings, split_set, Readings, DATE_LAYER_PATH};
use super::s1_tree::Plan;
use super::settings_paths;
use super::Failure;
use crate::db::repos::entities::reconcile;
use rusqlite::Connection;

/// 事务内自对账:十条对账 + E1 笔记标签集合按前缀映射全等、E2 计数逐项可解释、
/// E3 笔记 id 集合不变(由 E1 全等覆盖)、E4 信息流默认筛选不变、E5 时间簇读数、E6 设置三键。
pub(crate) fn self_check(conn: &Connection, plan: &Plan) -> Result<Vec<String>, Failure> {
    let mut out = Vec::new();
    let excused = ten_checks(conn, &plan.deleted_ids)?;
    if excused > 0 {
        out.push(format!(
            "对账 10 的 {excused} 行陈旧 graph_positions 键来自本轮删除的容器(P7:不清理,只记读数)"
        ));
    }
    out.push("十条对账 PASS 10 / FAIL 0".to_string());

    let del = plan.deletes();
    let post = readings(conn).map_err(check)?;
    let want = Readings {
        points: plan.pre.points - del,
        lines: plan.pre.lines - del,
        fts: plan.pre.fts - del,
        tree: plan.pre.tree - del,
        closure: plan.pre.closure - del,
        merge_log: plan.pre.merge_log + plan.merges as i64,
        feed: plan.pre.feed,
        time_nodes: plan.pre.time_nodes - del,
        time_edges: plan.pre.time_edges - del,
    };
    if post != want {
        return Err(Failure::check(format!(
            "E2 计数不符:前 {:?} / 后 {:?} / 期望 {:?}",
            plan.pre, post, want
        )));
    }
    let leftover: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM points WHERE path LIKE '时间/日期%'",
            [],
            |r| r.get(0),
        )
        .map_err(check)?;
    if leftover != 0 {
        return Err(Failure::check(format!(
            "E2 收敛后仍有 {leftover} 个 `时间/日期` 节点"
        )));
    }
    out.push(format!(
        "E2 计数变化逐项可解释(points/lines/points_fts/闭包/时间簇各 -{del}、entity_merge_log +{})",
        plan.merges
    ));
    out.push(format!(
        "E4 信息流默认筛选 {} 不变;E5 时间簇 {} -> {}(树边 {} -> {})",
        post.feed, plan.pre.time_nodes, post.time_nodes, plan.pre.time_edges, post.time_edges
    ));
    check_settings_refs(conn)?;

    let post_tags = note_tags(conn).map_err(check)?;
    let mapped: Vec<(i64, Vec<String>)> = plan
        .note_tags
        .iter()
        .map(|(id, joined)| {
            (
                *id,
                map_set(joined, DATE_LAYER_PATH, super::s1_sql::TIME_ROOT_PATH),
            )
        })
        .collect();
    let post_sets: Vec<(i64, Vec<String>)> = post_tags
        .iter()
        .map(|(id, j)| (*id, split_set(j)))
        .collect();
    if post_sets != mapped {
        return Err(Failure::check(format!(
            "E1 笔记标签集合不对应(前 {} 篇 / 后 {} 篇)",
            mapped.len(),
            post_sets.len()
        )));
    }
    out.push(format!(
        "E1 笔记标签集合逐一对应({} 篇,含无标签)",
        post_sets.len()
    ));
    out.push("E3 笔记 id 集合不变(已由 E1 的全等覆盖)".to_string());
    Ok(out)
}

/// 十条对账(spec §8 的 `reconcile.sql` 现代块;任何一块命中行即失败)。
/// 唯一例外 = 块 10 里**本轮删除容器**留下的陈旧 `graph_positions` 键(P7:只报不清理),
/// 它们计入返回值由调用方报读数;其余行一律判失败(含块 10 的其它行)。
fn ten_checks(conn: &Connection, deleted: &[i64]) -> Result<usize, Failure> {
    let blocks = reconcile::parse_checks(reconcile::RECONCILE_SQL, "modern");
    let ten: Vec<_> = blocks
        .iter()
        .filter(|b| (1..=10).any(|n| b.n == n.to_string()))
        .collect();
    if ten.len() != 10 {
        return Err(Failure::check(format!("对账块数异常:{}", ten.len())));
    }
    let mut excused = 0usize;
    for b in &ten {
        let rows = reconcile::run_check(conn, &b.sql)
            .map_err(|e| Failure::check(format!("对账 {} 执行失败: {e}", b.label())))?;
        if rows.is_empty() {
            continue;
        }
        let fatal: Vec<&String> = rows
            .iter()
            .filter(|r| !(b.n == "10" && row_is_deleted_key(r, deleted)))
            .collect();
        if !fatal.is_empty() {
            return Err(Failure::check(format!(
                "对账 {} 命中 {} 行:{:?}",
                b.label(),
                fatal.len(),
                &fatal[..fatal.len().min(3)]
            )));
        }
        excused += rows.len();
    }
    Ok(excused)
}

/// 对账行(如 `Text("12")`)是否就是本轮某个被删容器的 id
fn row_is_deleted_key(row: &str, deleted: &[i64]) -> bool {
    let cell = row.split(" | ").next().unwrap_or("").trim();
    let id = cell
        .strip_prefix("Text(\"")
        .and_then(|r| r.strip_suffix("\")"))
        .or_else(|| {
            cell.strip_prefix("Integer(")
                .and_then(|r| r.strip_suffix(")"))
        })
        .and_then(|t| t.parse::<i64>().ok());
    matches!(id, Some(id) if deleted.contains(&id))
}

/// E6:三个 settings 键里 `时间/日期` 出现次数必须为 0(不含时间路径的条目本就不动)
fn check_settings_refs(conn: &Connection) -> Result<(), Failure> {
    let keys = [
        settings_paths::MRU_TAGS_KEY,
        settings_paths::PINNED_TAGS_KEY,
        crate::db::repos::settings::FILTER_CURRENT_KEY,
    ];
    for key in keys {
        let Some(raw) = crate::db::repos::settings::get(conn, key).map_err(check)? else {
            continue;
        };
        let hits = raw.matches(DATE_LAYER_PATH).count();
        if hits > 0 {
            return Err(Failure::check(format!(
                "E6 `{key}` 里仍有 {hits} 处 `{DATE_LAYER_PATH}`"
            )));
        }
    }
    Ok(())
}
