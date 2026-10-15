//! 保存写线语义(设计 §6.2/§6.3;T3):把「源码里的目标 + 名字组」变成来源的全部非子级线。
//!
//! 两步:
//! 1. [`desired_lines`] 造**期望线表** —— 词元先按「路径首现序 + 名字组胜」收成 `TagLine`
//!    (规则只在解析层实现一次,这里只消费),再逐条解析目标 id 与名字点 id,最后把 `[[ ]]`
//!    目标并入(只补缺席的目标,不覆盖已有名字)。
//! 2. [`replace_lines`] 按期望线表整体替换:删多余 / 换名字 / 补缺失,一个目标只留一条线。
//!
//! 名字**不改线身份**:换名字 = `UPDATE lines SET name_id`(与 `set_tag_relation` 同口径),
//! 线 id 稳定,`lines` 触发器与 FTS 刷新口径都不变。删线 / 清名把旧名字点登记进
//! `queue_name_point_gc`,收尾由 `gc_orphans` 核对回收失去最后引用的名字点(spec §6.3)。
use crate::db::repos::tags::{
    gc_orphans, queue_name_point_gc, resolve_or_create_name_point, resolve_paths,
};
use crate::tags::TagLine;
use rusqlite::{params, Connection};

/// 期望线表 `(目标 id, 名字点 id)`:源码里出现的每个目标 + 它的名字组,就是来源该目标的期望状态。
/// 目标按 [`resolve_paths`] 解析(树内逐段寻址优先、其次别名、最后自动建树);名字按
/// [`resolve_or_create_name_point`] **逐字节**匹配 `meta`。
/// 先只解析目标、按目标合并名字组,**赢家才建名字点** —— 输掉的名字组不落地(§6.2 第 12 行)。
pub(crate) fn desired_lines(
    conn: &Connection,
    source_id: i64,
    lines: &[TagLine],
    body: &str,
) -> rusqlite::Result<Vec<(i64, Option<i64>)>> {
    let mut merged: Vec<(i64, Option<&str>)> = Vec::new();
    for line in lines {
        let target = resolve_paths(conn, std::slice::from_ref(&line.path))?;
        let Some(to) = target.first().copied() else { continue };
        match merged.iter_mut().find(|(t, _)| *t == to) {
            // 名字组胜:先无名后有名才补名字(两个名字组之间首现胜,不覆盖)
            Some(hit) => {
                if hit.1.is_none() {
                    hit.1 = line.name.as_deref();
                }
            }
            None => merged.push((to, line.name.as_deref())),
        }
    }
    // `[[ ]]` 只补缺席的目标:该目标已有名字时名字组胜(§6.2 第 14 行)
    for target in super::resolve_body(conn, source_id, body)? {
        if !merged.iter().any(|(t, _)| *t == target) {
            merged.push((target, None));
        }
    }
    // 同一次保存里同一个名字文本只解析一次:名字点的复用判据是「该点正被线当名字用」,
    // 而线要等全部名字解析完才落,不记账就会给同一个名字文本建出多个点(§6.2 第 2 行)
    let mut memo: Vec<(&str, i64)> = Vec::new();
    let mut out = Vec::with_capacity(merged.len());
    for (to, name) in merged {
        let name_id = match name {
            Some(n) => Some(match memo.iter().find(|(text, _)| *text == n) {
                Some((_, id)) => *id,
                None => {
                    let id = resolve_or_create_name_point(conn, n)?;
                    memo.push((n, id));
                    id
                }
            }),
            None => None,
        };
        out.push((to, name_id));
    }
    Ok(out)
}

/// 按期望线表整体替换来源的全部非子级线,返回**新落库的线数**(新建 + 换名字;幂等保存为 0)。
/// 三类判定:
/// - **删多余**:目标不在期望线表里的线(旧名字点登记回收);
/// - **换名字**:目标在、但没有一条线的名字与期望相同 —— 取该目标**最早那条线**改 `name_id`,
///   同目标的其余线一并删(即 §6.2 第 13 行的收敛);
/// - **补缺失**:该目标一条线都没有 —— 插一条期望名字的线。
pub(crate) fn replace_lines(
    conn: &Connection,
    source_id: i64,
    desired: &[(i64, Option<i64>)],
) -> rusqlite::Result<usize> {
    let current = super::named::rows(conn, source_id)?;
    let mut keep: Vec<i64> = Vec::new();
    let mut written = 0usize;
    for (to, want) in desired {
        let group: Vec<&(i64, i64, Option<i64>)> =
            current.iter().filter(|(_, t, _)| t == to).collect();
        let kept = match group.iter().find(|(_, _, n)| n == want) {
            // 已有一条名字完全相同的线:就是它(同目标其余线按多余处理)
            Some(row) => Some(row.0),
            None => match group.first() {
                // 换名字:同一条线改 name_id;旧名字点失去引用后由收尾 GC 回收
                Some(row) => {
                    if let Some(old) = row.2.filter(|o| Some(*o) != *want) {
                        queue_name_point_gc(conn, old)?;
                    }
                    let n = conn.execute(
                        "UPDATE lines SET name_id = ?1 WHERE id = ?2",
                        params![want, row.0],
                    )?;
                    written += n;
                    Some(row.0)
                }
                // 补缺失
                None => {
                    written += conn.execute(
                        "INSERT INTO lines(from_id, to_id, name_id, created_at)
                         VALUES(?1, ?2, ?3, datetime('now', 'localtime'))",
                        params![source_id, to, want],
                    )?;
                    None
                }
            },
        };
        if let Some(id) = kept {
            keep.push(id);
        }
    }
    for (line_id, _, name_id) in &current {
        if keep.contains(line_id) {
            continue;
        }
        conn.execute("DELETE FROM lines WHERE id = ?1", params![line_id])?;
        if let Some(nid) = name_id {
            queue_name_point_gc(conn, *nid)?;
        }
    }
    gc_orphans(conn)?;
    Ok(written)
}
