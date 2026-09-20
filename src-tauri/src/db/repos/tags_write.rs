//! 标签写入的统一收尾(自 tags_tree_ops / tags_tree_merge 的四处手写三步收敛而来)。
//! 任何改动 tag_links / tags 的事务,结束前都必须调 [`finish`] 一次 ——
//! 固定顺序 ① 路径级联 ② FTS 重写 ③ 孤儿回收由这里保证,调用方不必(也不应)自己记得。
//! 为什么 FTS 必须显式重写:tag_links 自迁移 003 起只有 INSERT/DELETE 触发器,
//! `UPDATE tag_links SET tag_id` 不会触发 → 漏写就静默漂移(按新名搜不到、旧名仍命中)。
use super::tags_tree::{gc_orphans, refresh_fts};
use super::tabs_rewrite;
use rusqlite::Connection;

/// 标签写入的收尾输入(见 [`finish`])。调用方按自己的语义填:仅改名可 `gc: false`、
/// 删除传 `path_change: None`(删除按设计不改写标签页条件)。
pub(crate) struct PostWrite<'a> {
    /// 受影响笔记(需重写 FTS 标签列);空切片表示无需刷新
    pub notes: &'a [i64],
    /// 路径变化(旧, 新):Some 时级联改写 settings.tabs_state 里的引用;None 表示路径没变
    pub path_change: Option<(&'a str, &'a str)>,
    /// 是否回收孤儿标签(无链接且无子节点)。删除/移动/合并/替换链接后应为 true;仅改名可 false
    pub gc: bool,
}

/// 固定顺序执行:① 路径级联(若给) ② FTS 重写(若 notes 非空) ③ 孤儿回收(若 gc)。
/// 顺序不可换:FTS 聚合只读 tags JOIN tag_links,回收孤儿(无链接)不改变聚合结果,
/// 但显式重写必须在删除标签之后 —— 否则被删路径会残留在索引串里。
/// 错误原样上抛,由调用方 `.map_err(|e| e.to_string())` 转中文报错。
pub(crate) fn finish(conn: &Connection, p: PostWrite<'_>) -> rusqlite::Result<()> {
    if let Some((old, new)) = p.path_change {
        tabs_rewrite::rewrite_prefix(conn, old, new)?;
    }
    if !p.notes.is_empty() {
        refresh_fts(conn, p.notes)?;
    }
    if p.gc {
        gc_orphans(conn)?;
    }
    Ok(())
}
