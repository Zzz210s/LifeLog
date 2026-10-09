//! 分组键的 SQL 片段(自 `notes_group.rs` 拆出,守 200 行):轴 -> 一级子标签。
//! 长度参数用整数绑定传入,避免同一个 `?` 在文本里重复绑九次(平铺/分组的其他片段
//! 都用无编号 `?`,所以这里也不能用 `?1` 这类编号参数 —— 会与 where_clause 的下标撞车)。
use rusqlite::types::Value;

/// 一级组树序键的字符长度:`ord` 键是 6 位零填充段以 `/` 拼接,深度 d 的键长 = 7d - 1;
/// 一级组深度 = 轴段数 + 1 => 7*(轴段数+1) - 1 = 7*轴段数 + 6。
pub fn group_key_len(path: &str) -> i64 {
    7 * path.split('/').count() as i64 + 6
}

/// 分组键 CTE:`grp(note_id, key, gok)` —— 每条笔记 -> 所属一级子标签 + 它的树序键。
/// 参数按 SQL 文本顺序压入:轴长 / 一级组键长 / 轴长 / 轴路径 / 轴长 / 轴路径。
/// 键算法:`slash` = 轴之后第一个 `/` 在 `t.path` 里的位置;`slash = 0` 说明 `t.path`
/// 就是轴本级或一级子标签,键即 `t.path`;否则 `substr(t.path, 1, 轴长 + slash)`
/// 恰为「轴 + '/' + 第一段」。
/// 多值:`ROW_NUMBER() OVER (PARTITION BY 笔记 ORDER BY ord 键)` 取树序第一 -> 只进一组。
/// `gok` = 该一级组的 ord 键前缀(前缀即祖先键,因为每级 7 个字符对齐)。
pub fn group_key_cte(path: &str, args: &mut Vec<Value>) -> String {
    let axis_len = path.chars().count() as i64;
    let text = Value::Text(path.to_string());
    for a in [
        Value::Integer(axis_len),
        Value::Integer(group_key_len(path)),
        Value::Integer(axis_len),
        text.clone(),
        Value::Integer(axis_len),
        text,
    ] {
        args.push(a);
    }
    "grp(note_id, key, gok) AS (
    SELECT note_id, key, gok FROM (
      SELECT x.note_id AS note_id,
             CASE WHEN x.slash = 0 THEN x.tpath
                  ELSE substr(x.tpath, 1, ? + x.slash) END AS key,
             substr(o.key, 1, ?) AS gok,
             ROW_NUMBER() OVER (PARTITION BY x.note_id ORDER BY o.key) AS rn
      FROM (SELECT l.source_id AS note_id, t.id AS tid, t.path AS tpath,
                   instr(substr(t.path, ? + 2), '/') AS slash
            FROM edges l JOIN entities t ON t.id = l.target_id
            WHERE l.kind = 'link'
              AND (t.path = ? OR substr(t.path, 1, ? + 1) = ? || '/')) x
      JOIN ord o ON o.id = x.tid
    ) WHERE rn = 1
  )"
    .to_string()
}
