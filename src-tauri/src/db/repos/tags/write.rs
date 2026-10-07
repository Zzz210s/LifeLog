//! 标签写入的统一收尾(自 tags_tree_ops / tags_tree_merge 的四处手写三步收敛而来)。
//! 任何改动边表/标签实体的事务,结束前都必须调 [`finish`] 一次 ——
//! 固定顺序 ① 路径级联 ② entities_fts 重写 ③ 孤儿回收由这里保证。
//! 为什么 FTS 必须显式重写:`edges` 的 UPDATE 不改变 FTS(改名只改实体 path);
//! 漏写就静默漂移(按新名搜不到、旧名仍命中)。阶段 4 起只需重写 `entities_fts`。
use super::tree::{gc_orphans, refresh_entities_fts};
use crate::db::repos::filter_rewrite;
use rusqlite::Connection;

/// 标签写入的收尾输入(见 [`finish`])。调用方按自己的语义填:仅改名可 `gc: false`、
/// 删除传 `path_change: None`(删除按设计不改写筛选条件)。
pub(crate) struct PostWrite<'a> {
    /// 受影响标签实体(需重写 entities_fts);空切片表示无需刷新
    pub entities: &'a [i64],
    /// 路径变化(旧, 新):Some 时级联改写 settings.filter_current 里的引用;None 表示路径没变
    pub path_change: Option<(&'a str, &'a str)>,
    /// 是否回收孤儿标签(无出边且无 child 以外的入边)。删除/移动/合并/替换链接后应为 true;仅改名可 false
    pub gc: bool,
}

/// 固定顺序执行:① 路径级联(若给) ② entities_fts 重写(若非空) ③ 孤儿回收(若 gc),
/// 再跑一次同父同名自动合并(设计 2026-10-06 §6:任何写入后重名即并)。
/// 顺序不可换:结构变更会改聚合口径(路径、链接集合),显式重写必须在删除标签之后 ——
/// 否则被删路径会残留在索引串里。
/// 错误原样上抛,由调用方 `.map_err(|e| e.to_string())` 转中文报错。
pub(crate) fn finish(conn: &Connection, p: PostWrite<'_>) -> rusqlite::Result<()> {
    finish_core(conn, p)?;
    super::auto_merge::sweep(conn).map_err(rusqlite::Error::InvalidParameterName)?;
    Ok(())
}

/// [`finish`] 的三步本体:合并核心(merge.rs)复用它以免自动合并递归。
pub(crate) fn finish_core(conn: &Connection, p: PostWrite<'_>) -> rusqlite::Result<()> {
    if let Some((old, new)) = p.path_change {
        filter_rewrite::rewrite_filter_paths(conn, old, new)?;
    }
    if !p.entities.is_empty() {
        refresh_entities_fts(conn, p.entities)?;
    }
    if p.gc {
        gc_orphans(conn)?;
    }
    Ok(())
}
