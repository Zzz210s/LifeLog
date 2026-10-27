//! notes 更新层(自 notes.rs 拆出以守 200 行上限):update。
//! 链接为增量替换(未变化的标签链不动),收尾由 tags_tree 精确回收孤儿。
//! 时间标签已是普通标签(D3):不再有"系统添加必须保留"的特例 —— 编辑界面把标签
//! 回显为 `#tag` 文本,正文里带回来的标签就是最终集合(想去/改时间就改那段文本)。
use super::read_full;
use rusqlite::{params, Connection};

/// 更新笔记正文(事务):剥离/提取标签后整条重存,链接为替换语义。
/// id 不存在返回 None;成功返回含全量标签的最新笔记。
pub fn update(conn: &mut Connection, id: i64, content: &str) -> rusqlite::Result<Option<super::Note>> {
    // 解析入口与 create 同一处:严格语法优先,严格失败处按库内已有路径兜底;
    // 落库吃的是「目标 + 名字组」(设计 §6.2/§6.3)
    let (lines, text) = super::parse_saved(conn, content)?;
    let paths: Vec<String> = lines.iter().map(|l| l.path.clone()).collect();
    let tx = conn.transaction()?;
    // 统一元数据(v31):正文只落 `points.meta`,不再有 kind。
    let rows = tx.execute("UPDATE points SET meta=?1 WHERE id=?2", params![text, id])?;
    if rows == 0 {
        return Ok(None); // 无该行:回滚空事务
    }
    // 审计:替换语义会把"正文里没出现的标签"一并移除 —— UI 编辑路径会回显全部标签所以正常不触发,
    // 但脚本/裸命令按正文重建内容时会静默抹掉标签(本库曾因此丢过 10 条笔记的标签,靠快照才发现)。
    // 这里只记一条日志,不改语义。
    let before = tag_paths(&tx, id)?;
    if paths.len() < before.len() {
        eprintln!(
            "更新笔记 {id}: 标签 {} 条 -> {} 条,被移除的标签:{}",
            before.len(),
            paths.len(),
            before.iter().filter(|p| !paths.contains(p)).cloned().collect::<Vec<_>>().join(" ")
        );
    }
    // 名字面的对读快照必须在写库前取:被换掉 / 清掉的旧名字点在收尾 GC 里就没了
    let names_before = name_snapshot(&tx, id)?;
    // 标签(`#X`)与链接(`[[X]]`)目标求并集后一次整体替换(spec §5.2:同一种边)。
    super::write_saved_links(&tx, id, &lines, &text)?;
    log_name_changes(id, &names_before, &name_snapshot(&tx, id)?);
    let note = read_full(&tx, id)?;
    tx.commit()?;
    Ok(note)
}

/// 名字面的对读快照(顺序 = 线 id):`(目标 id, 目标路径, 可选名字文本)`。
/// 目标可以是树外点(`path IS NULL`),故路径是 Option,日志里再折成可读文本。
type NameRow = (i64, Option<String>, Option<String>);

fn name_snapshot(conn: &Connection, id: i64) -> rusqlite::Result<Vec<NameRow>> {
    let mut stmt = conn.prepare(
        "SELECT l.to_id, t.path, nm.meta FROM non_tree_lines l
           JOIN points t ON t.id = l.to_id
           LEFT JOIN points nm ON nm.id = l.name_id
          WHERE l.from_id = ?1
          ORDER BY l.id",
    )?;
    let rows = stmt.query_map(params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    rows.collect()
}

/// 名字面的审计(设计 §6.3):只记日志,不改语义 —— 清名字 / 换名字 / 同一目标多条名线收敛
/// 在 UI 上都没痕迹,数据出问题时靠这几行回溯(与上面「标签被移除」同一做法)。
fn log_name_changes(id: i64, before: &[NameRow], after: &[NameRow]) {
    let text = |n: &Option<String>| n.as_deref().unwrap_or("无名字").to_string();
    let mut seen: Vec<i64> = Vec::new();
    for (to, path, old) in before {
        if seen.contains(to) {
            continue;
        }
        seen.push(*to);
        let Some(new) = after.iter().find(|(t, _, _)| t == to) else {
            continue; // 整条线没了:上面那条「标签被移除」日志已覆盖
        };
        let label = path.as_deref().map(str::to_string).unwrap_or_else(|| format!("树外目标 {to}"));
        let olds: Vec<String> =
            before.iter().filter(|(t, _, _)| t == to).map(|(_, _, n)| text(n)).collect();
        if olds.len() > 1 {
            eprintln!(
                "更新笔记 {id}: 目标 {label} 原有 {} 条名线({}),收敛为一条 {}",
                olds.len(),
                olds.join(" / "),
                text(&new.2)
            );
        } else if new.2 != *old {
            eprintln!("更新笔记 {id}: 目标 {label} 关系名 {} -> {}", text(old), text(&new.2));
        }
    }
}

/// 读取笔记当前标签的完整路径(树语义真源,供 update 的「标签被移除」审计日志对读)。
/// 只取非子级线目标中在树内的点(`path IS NOT NULL`),树外笔记目标不计入标签。
fn tag_paths(conn: &rusqlite::Connection, id: i64) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT t.path FROM non_tree_lines l JOIN points t ON t.id = l.to_id
         WHERE t.path IS NOT NULL AND l.from_id=?1
         ORDER BY t.path",
    )?;
    let rows = stmt.query_map(params![id], |r| r.get(0))?;
    rows.collect()
}

#[cfg(test)]
#[path = "notes_update_tests.rs"]
mod notes_update_tests;

#[cfg(test)]
#[path = "notes_tree_edit_tests.rs"]
mod notes_tree_edit_tests;
