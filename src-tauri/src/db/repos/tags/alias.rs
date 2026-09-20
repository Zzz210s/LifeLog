//! 标签别名仓库层(spec 2026-09-20 §3.2):别名不是节点 —— 不进树、不计入计数、
//! 不参与 FTS 标签列;删除目标标签时由 tag_aliases 的 ON DELETE CASCADE 清理
//! (db::open 已开 foreign_keys=ON)。
//! 解析必须可预测(D2):只有别名表里登记过的**原样字符串**才会被归一,不做模糊猜测。
use rusqlite::{params, Connection, OptionalExtension};

/// 命中别名则返回目标标签的**当前路径**(路径随改名/移动实时变化,故每次联表取),
/// 未命中返回 None。path 先 trim:与解析器口径一致(登记时禁止空白,故 trim 不会误命中)。
pub fn resolve(conn: &Connection, path: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT t.path FROM tag_aliases a JOIN tags t ON t.id = a.tag_id WHERE a.alias = ?1",
        params![path.trim()],
        |r| r.get(0),
    )
    .optional()
}

/// 该标签的全部别名(按 alias 升序),供标签菜单展示
pub fn list_for_tag(conn: &Connection, tag_id: i64) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT alias FROM tag_aliases WHERE tag_id = ?1 ORDER BY alias")?;
    let rows = stmt.query_map(params![tag_id], |r| r.get(0))?;
    rows.collect()
}

/// 登记别名:同一别名重复登记视为**更新指向**(INSERT OR REPLACE)。
/// 别名必须是非空、不含空白、不含 `#` 的原样字符串;与**现有标签路径**同名则拒绝 ——
/// 否则真实标签会被别名劫持,与 D4"冲突时以现有标签为准"是同一条原则。
/// G3 命令层(add_tag_alias)的生产调用方
pub fn add(conn: &Connection, alias: &str, tag_id: i64) -> rusqlite::Result<()> {
    check_alias(alias)?;
    if tag_path_exists(conn, alias)? {
        return Err(invalid("别名与现有标签重名"));
    }
    put(conn, alias, tag_id)
}

/// 删除别名:不存在也不报错(重复删除幂等)
pub fn remove(conn: &Connection, alias: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM tag_aliases WHERE alias = ?1",
        params![alias.trim()],
    )?;
    Ok(())
}

/// 改名后自动登记旧名(D4):旧**完整路径**必登记;旧**叶子名**仅在与现有标签路径不冲突、
/// 且未被别的标签占用时才登记(冲突时以现有标签为准,不覆盖真实标签)。
/// 返回**实际登记**的别名列表:完整路径在前,叶子名在后(供命令层回报给界面)。
pub fn register_rename(
    conn: &Connection,
    old_path: &str,
    new_tag_id: i64,
) -> rusqlite::Result<Vec<String>> {
    let old_path = old_path.trim();
    if old_path.is_empty() {
        return Ok(Vec::new());
    }
    let mut registered = vec![old_path.to_string()];
    // 旧完整路径原样写入、不做冲突判定:rename 先完成路径重写,old_path 在库里已无对应标签
    // (path 唯一索引),若它先前是别的标签的别名,本次改名按"重复登记即更新指向"接管。
    put(conn, old_path, new_tag_id)?;
    // 旧叶子名:根标签的叶子名 == 完整路径,上面已登记过,不重复登记
    if let Some(leaf) = old_path.rsplit('/').next().filter(|l| *l != old_path) {
        if leaf_available(conn, leaf, new_tag_id)? {
            put(conn, leaf, new_tag_id)?;
            registered.push(leaf.to_string());
        }
    }
    Ok(registered)
}

/// 目标标签是否存在。命令层 add_tag_alias 用它先给中文错:直接写库只会漏出
/// sqlite 的 `FOREIGN KEY constraint failed`(英文),对界面无意义
pub fn tag_exists(conn: &Connection, tag_id: i64) -> rusqlite::Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tags WHERE id = ?1",
        params![tag_id],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

/// 别名合法性:非空、不含任何空白、不含 `#`(完整路径的层级分隔 `/` 允许)
fn check_alias(alias: &str) -> rusqlite::Result<()> {
    if alias.is_empty() {
        return Err(invalid("别名不能为空"));
    }
    if alias.chars().any(char::is_whitespace) {
        return Err(invalid("别名不能包含空白字符"));
    }
    if alias.contains('#') {
        return Err(invalid("别名不能包含 #"));
    }
    Ok(())
}

/// 写入别名行(不做语义判定):INSERT OR REPLACE 即"重复登记更新指向"
fn put(conn: &Connection, alias: &str, tag_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO tag_aliases(alias, tag_id) VALUES(?1, ?2)",
        params![alias, tag_id],
    )?;
    Ok(())
}

/// 是否已有同名**标签路径**(别名不得劫持真实标签)
fn tag_path_exists(conn: &Connection, path: &str) -> rusqlite::Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tags WHERE path = ?1",
        params![path],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

/// 叶子名可否登记给 new_tag_id:名字合法、不与现有标签路径同名、且未被**别的**标签占用。
/// 已登记给自己视为可用:重复登记让它留在返回列表里,对外读数一致(改名幂等)。
fn leaf_available(conn: &Connection, leaf: &str, new_tag_id: i64) -> rusqlite::Result<bool> {
    if check_alias(leaf).is_err() || tag_path_exists(conn, leaf)? {
        return Ok(false);
    }
    let owner: Option<i64> = conn
        .query_row(
            "SELECT tag_id FROM tag_aliases WHERE alias = ?1",
            params![leaf],
            |r| r.get(0),
        )
        .optional()?;
    Ok(owner.is_none() || owner == Some(new_tag_id))
}

/// 仓库层中文报错(与 tags_tree 既有非法参数报错同一类型)
fn invalid(msg: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(msg.to_string())
}

#[cfg(test)]
#[path = "alias_tests.rs"]
mod alias_tests;
