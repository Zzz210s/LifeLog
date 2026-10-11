//! S1 树收敛本体(设计 2026-10-12 §4–§6):年 / 月子树上提、同名整棵合并、删 `时间/日期` 中间层、
//! 三个 settings 键的路径改写、`points_fts` 兜底重建、事务内自对账(SQL 常量见 `s1_sql`,
//! 对账见 `s1_self_check`)。搬移与合并复用产品写路径 [`move_to_ordered_core`](同名者内部走
//! `merge_pair` 整棵合并并写 `entity_merge_log`),不写裸 SQL 重实现;`plan` 只读,`apply` 在
//! **一个** `BEGIN IMMEDIATE` 内完成全部写入,自对账失败即整体回滚(退出码 3)。
use super::s1_self_check::{self, note_tags};
use super::s1_sql::{
    check, children_of, leaf_name, path_id, sibling_by_key, usage, CLOSURE_SQL, DATE_LAYER_PATH,
    FEED_DEFAULT_SQL, TIME_EDGES_SQL, TIME_NODES_SQL, TIME_ROOT_PATH,
};
use super::settings_paths;
use super::Failure;
use crate::db::repos::tags::move_to_ordered_core;
use rusqlite::{params, Connection, TransactionBehavior};

/// 收敛前读数(E2/E4/E5 的比对基准);现场重算,不硬编码
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Readings {
    pub points: i64,
    pub lines: i64,
    pub fts: i64,
    pub tree: i64,
    pub closure: i64,
    pub merge_log: i64,
    /// 信息流默认筛选命中数(E4;S1 前后必须不变)
    pub feed: i64,
    /// 「时间」簇节点与树边(E5;各减被删容器数)
    pub time_nodes: i64,
    pub time_edges: i64,
}

/// 只读计划:待搬年容器、预判合并次数、前像(读数与笔记标签集合)
#[derive(Debug)]
pub struct Plan {
    /// `时间/日期` 不存在(S1 已收敛):`apply` 零写入
    pub already_done: bool,
    pub time_root: i64,
    /// 待上提的年容器 id,按 `path` 升序
    pub years: Vec<i64>,
    /// 预判的同名整棵合并次数(年 1 次 + 其下月容器与既有同名者各 1 次)
    pub merges: usize,
    pub pre: Readings,
    /// 笔记 id -> 升序标签路径串(`\n` 相接;无标签为空串)。E1/E3 的前像。
    pub note_tags: Vec<(i64, String)>,
}

impl Plan {
    /// 预计删除点数 = 中间层 1 + 每次同名合并删掉 1 个源容器
    pub fn deletes(&self) -> i64 {
        1 + self.merges as i64
    }

    /// dry-run 报告(dry-run 只读,零写入)
    pub fn describe(&self) -> Vec<String> {
        if self.already_done {
            return vec!["无需处理:`时间/日期` 不存在(S1 已收敛)".to_string()];
        }
        vec![format!(
            "计划:搬移 {} 个年容器、同名整棵合并 {} 次、删中间层 `时间/日期`;预计 points/lines/points_fts/闭包/时间簇各 -{}、entity_merge_log +{}、信息流默认筛选 {} 不变",
            self.years.len(),
            self.merges,
            self.deletes(),
            self.merges,
            self.pre.feed
        )]
    }
}

pub fn readings(conn: &Connection) -> rusqlite::Result<Readings> {
    let one = |sql: &str| -> rusqlite::Result<i64> { conn.query_row(sql, [], |r| r.get(0)) };
    Ok(Readings {
        points: one("SELECT COUNT(*) FROM points")?,
        lines: one("SELECT COUNT(*) FROM lines")?,
        fts: one("SELECT COUNT(*) FROM points_fts")?,
        tree: one("SELECT COUNT(*) FROM points WHERE path IS NOT NULL")?,
        closure: one(CLOSURE_SQL)?,
        merge_log: one("SELECT COUNT(*) FROM entity_merge_log")?,
        feed: one(FEED_DEFAULT_SQL)?,
        time_nodes: one(TIME_NODES_SQL)?,
        time_edges: one(TIME_EDGES_SQL)?,
    })
}

/// 只读计划:校验前置(③④)+ 预判合并次数 + 抓前像。**零写入**。
pub fn plan(conn: &Connection) -> Result<Plan, Failure> {
    let pre = readings(conn).map_err(usage)?;
    let note_tags = note_tags(conn).map_err(usage)?;
    let Some(time_root) = path_id(conn, TIME_ROOT_PATH).map_err(usage)? else {
        return Err(Failure::usage(format!(
            "库内没有 `{TIME_ROOT_PATH}` 根,拒绝执行"
        )));
    };
    let Some(layer) = path_id(conn, DATE_LAYER_PATH).map_err(usage)? else {
        return Ok(Plan {
            already_done: true,
            time_root,
            years: Vec::new(),
            merges: 0,
            pre,
            note_tags,
        });
    };
    let children = children_of(conn, layer).map_err(usage)?;
    let mut years = Vec::with_capacity(children.len());
    for (id, path) in &children {
        let leaf = leaf_name(path);
        if leaf.len() != 4 || !leaf.bytes().all(|b| b.is_ascii_digit()) {
            return Err(Failure::usage(format!(
                "`{DATE_LAYER_PATH}` 子级 {path} 不是 4 位年容器,拒绝执行"
            )));
        }
        years.push(*id);
    }
    let mut merges = 0usize;
    for (id, path) in &children {
        let Some(target) = sibling_by_key(conn, time_root, leaf_name(path), *id).map_err(usage)?
        else {
            continue;
        };
        merges += 1; // 年容器整棵合并
        for (mid, mpath) in children_of(conn, *id).map_err(usage)? {
            if sibling_by_key(conn, target, leaf_name(&mpath), mid)
                .map_err(usage)?
                .is_some()
            {
                merges += 1; // 月容器随年合并时再撞名
            }
        }
    }
    Ok(Plan {
        already_done: false,
        time_root,
        years,
        merges,
        pre,
        note_tags,
    })
}

/// 单事务执行 + 自对账。自对账失败返回码 3,事务由 `Transaction` 的 Drop 回滚。
pub fn apply(conn: &mut Connection, plan: &Plan) -> Result<Vec<String>, Failure> {
    if plan.already_done {
        return Ok(vec!["S1 已收敛(`时间/日期` 不存在),零写入".to_string()]);
    }
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| Failure::check(format!("开启事务失败: {e}")))?;
    for id in &plan.years {
        move_to_ordered_core(&tx, *id, Some(plan.time_root), None)
            .map_err(|e| Failure::check(format!("搬移年容器 {id} 失败: {e}")))?;
    }
    drop_date_layer(&tx)?;
    let touched = settings_paths::rewrite(&tx, DATE_LAYER_PATH, TIME_ROOT_PATH)
        .map_err(|e| Failure::check(format!("改写 settings 路径失败: {e}")))?;
    rebuild_fts(&tx)?;
    let mut out = s1_self_check::self_check(&tx, plan)?;
    if !touched.is_empty() {
        out.push(format!("settings 路径改写: {}", touched.join(", ")));
    }
    tx.commit()
        .map_err(|e| Failure::check(format!("提交失败: {e}")))?;
    Ok(out)
}

/// 中间层兜底删除:`move_to` 的 gc 通常已回收它;仍在则必须空(无子级、无笔记引用)才删。
fn drop_date_layer(conn: &Connection) -> Result<(), Failure> {
    let Some(layer) = path_id(conn, DATE_LAYER_PATH).map_err(check)? else {
        return Ok(());
    };
    let kids: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM points WHERE parent_id = ?1",
            params![layer],
            |r| r.get(0),
        )
        .map_err(check)?;
    if kids > 0 {
        return Err(Failure::check(format!(
            "`{DATE_LAYER_PATH}` 仍有 {kids} 个子级,拒绝留下中间层"
        )));
    }
    conn.execute(
        "DELETE FROM points WHERE id = ?1 AND path IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM points c WHERE c.parent_id = ?1)
           AND NOT EXISTS (SELECT 1 FROM lines l
                            WHERE l.to_id = ?1 AND (l.name_id IS NULL OR l.name_id <> 0))",
        params![layer],
    )
    .map_err(check)?;
    Ok(())
}

/// `points_fts` 兜底全量重建:批量搬移下靠触发器逐行刷新可能漏项,事务内一次性重算。
fn rebuild_fts(conn: &Connection) -> Result<(), Failure> {
    conn.execute_batch(
        "DELETE FROM points_fts;
         INSERT INTO points_fts(rowid, meta, paths) SELECT id, meta, paths FROM points_fts_src;",
    )
    .map_err(|e| Failure::check(format!("重建 points_fts 失败: {e}")))
}
