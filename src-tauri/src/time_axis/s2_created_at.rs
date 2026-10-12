//! S2 `created_at` 修复本体(设计 2026-10-12 §7 / 计划 T4):只对带日标签的笔记把 `created_at`
//! 写成 `<该日> 00:00:00`(本地时区);无日标签的笔记一律不动,只改这一个物理列。
//! `plan` 只读;`apply` 在一个 `BEGIN IMMEDIATE` 内逐行 UPDATE,写完自对账失败即整体回滚(码 3)。
//! 日标签谓词兼容 S1 前后两种形状(P6),故 S2 可独立执行;解析不出合法日期的命中行拒绝 apply(码 2)。
//! 真库「一篇多日标签」为 0 篇;spec §7 未定该口径,本实现拍板取**最早一天**(见测试与试跑报告)。
//! 谓词与查询助手在 [`s2_sql`];事务内自对账在 `s2_sql::self_check`。
use super::s1_sql::Readings;
use super::s2_sql::{all_notes, day_of, day_tags, is_same_day, self_check};
use super::Failure;
use rusqlite::{params, Connection, TransactionBehavior};
use std::collections::BTreeMap;

pub use super::s2_sql::readings;

/// 一条待修笔记:命中且日期可解析
#[derive(Debug, Clone)]
pub struct Hit {
    pub id: i64,
    pub day: String,
    pub old: String,
    pub new: String,
}

/// 一条解析失败的命中笔记(路径匹配日标签谓词但拼不出合法日期)
#[derive(Debug, Clone)]
pub struct Bad {
    pub id: i64,
    pub path: String,
    pub why: String,
}

/// 只读计划:命中集合、失败清单、多日标签清单、前像读数与全部笔记的 `(id, created_at)`
#[derive(Debug)]
pub struct Plan {
    pub hits: Vec<Hit>,
    pub bad: Vec<Bad>,
    /// 一篇挂多个日标签的笔记 `(id, 升序日期串)`:取最早一天(真库 0 篇,规则为本次拍板)
    pub multi: Vec<(i64, Vec<String>)>,
    /// 无日标签笔记数(一律不动)
    pub untouched: i64,
    pub pre: Readings,
    /// 全部笔记的 `(id, created_at)` 前像,供自对账逐篇核对
    pub notes: Vec<(i64, String)>,
}

impl Plan {
    /// dry-run 报告:命中篇数 + 逐日分布 + 解析失败清单 + 多日标签清单
    pub fn describe(&self) -> Vec<String> {
        let same = self.hits.iter().filter(|h| is_same_day(h)).count();
        let mut out = vec![format!(
            "S2 计划:命中 {} 篇(日期不变 {same}、会变 {}、不动 {});解析失败 {} 篇",
            self.hits.len(),
            self.hits.len() - same,
            self.untouched,
            self.bad.len()
        )];
        let mut dist: BTreeMap<&str, i64> = BTreeMap::new();
        for h in &self.hits {
            *dist.entry(h.day.as_str()).or_default() += 1;
        }
        for (day, n) in &dist {
            out.push(format!("分布 {day}: {n} 篇"));
        }
        for (id, days) in &self.multi {
            out.push(format!("多日标签 笔记 {id}: {}(取最早)", days.join(",")));
        }
        for b in &self.bad {
            out.push(format!(
                "解析失败 笔记 {}: 路径 {} ({})",
                b.id, b.path, b.why
            ));
        }
        out
    }
}

/// 只读计划。**零写入**。
pub fn plan(conn: &Connection) -> Result<Plan, Failure> {
    let pre = readings(conn)?;
    let notes = all_notes(conn).map_err(check)?;
    let old_of: BTreeMap<i64, String> = notes.iter().cloned().collect();
    let by_note = day_tags(conn).map_err(check)?;

    let mut hits = Vec::new();
    let mut bad = Vec::new();
    let mut multi = Vec::new();
    for (id, paths) in &by_note {
        let mut days = Vec::new();
        let mut failed: Option<(String, String)> = None;
        for p in paths {
            match day_of(p) {
                Some(d) => days.push(d),
                None => failed = Some((p.clone(), "日标签路径拼不出合法日期".to_string())),
            }
        }
        if let Some((path, why)) = failed {
            bad.push(Bad { id: *id, path, why });
            continue;
        }
        days.sort();
        days.dedup();
        if days.len() > 1 {
            multi.push((*id, days.clone()));
        }
        let day = days.into_iter().next().unwrap_or_default();
        let old = old_of.get(id).cloned().unwrap_or_default();
        hits.push(Hit {
            id: *id,
            new: format!("{day} 00:00:00"),
            day,
            old,
        });
    }
    let untouched = notes.len() as i64 - by_note.len() as i64;
    Ok(Plan {
        hits,
        bad,
        multi,
        untouched,
        pre,
        notes,
    })
}

/// 单事务执行 + 自对账。非法日期命中则拒绝(码 2,库不变);自对账失败返回码 3,事务回滚。
pub fn apply(conn: &mut Connection, plan: &Plan) -> Result<Vec<String>, Failure> {
    if !plan.bad.is_empty() {
        let list: Vec<String> = plan
            .bad
            .iter()
            .map(|b| format!("{} -> {}", b.id, b.path))
            .collect();
        return Err(Failure::usage(format!(
            "有 {} 篇命中笔记的日标签非法,拒绝 apply:{}",
            plan.bad.len(),
            list.join("; ")
        )));
    }
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| Failure::check(format!("开启事务失败: {e}")))?;
    for h in &plan.hits {
        tx.execute(
            "UPDATE points SET created_at = ?1 WHERE id = ?2",
            params![h.new, h.id],
        )
        .map_err(|e| Failure::check(format!("更新笔记 {} 失败: {e}", h.id)))?;
    }
    let out = self_check(&tx, plan)?;
    tx.commit()
        .map_err(|e| Failure::check(format!("提交失败: {e}")))?;
    Ok(out)
}

fn check(e: impl ToString) -> Failure {
    Failure::check(e.to_string())
}
