//! 021/022 的 `tags.is_type` 增删钩子(自 migration_hooks.rs 拆出,守单文件 200 行):
//! SQLite 的 `ADD COLUMN` / `DROP COLUMN` 都没有 IF (NOT) EXISTS,迁移重放会报
//! duplicate column / no such column,写不进纯 SQL,只能在 Rust 侧按列存在性决定。
use rusqlite::Connection;

/// 021 新增 `tags.is_type`:SQLite 的 `ALTER TABLE ADD COLUMN` 没有 IF NOT EXISTS,
/// 迁移重放会报 duplicate column name,故在钩子里按列存在性决定是否 ADD COLUMN
/// (与 012 的跳过同理,但那里是 DROP、这里是 ADD,写不进纯 SQL)。
pub(crate) const TYPES_VERSION: i64 = 21;

/// 表是否存在(搬迁钩子按它决定空操作;pragma_table_info 对不存在的表返回空,但这里要取名字)
fn table_exists(conn: &Connection, name: &str) -> rusqlite::Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [name],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

/// 021 之前把 roles/tag_roles 搬进标签系统(搬迁优先于默默删表,与 013/014 的「动手前留读数」同一用意):
/// `roles.tag_id` 对应标签置 `is_type=1`;`tag_roles(tag_id, role_id)` 转成 tag_links 的
/// `'type'` 边 `(tag_id, 'type', roles.tag_id)`。两表都在 020 建,缺任一表(新库/重放)即空操作;
/// UPDATE 与 INSERT OR IGNORE 幂等,「钩子已跑、版本仍 20」的崩溃重放不会重复写。
pub(crate) fn carry_over_role_tables(conn: &Connection) -> rusqlite::Result<()> {
    if !table_exists(conn, "roles")? || !table_exists(conn, "tag_roles")? {
        return Ok(());
    }
    let roles: i64 = conn.query_row("SELECT COUNT(*) FROM roles", [], |r| r.get(0))?;
    let claims: i64 = conn.query_row("SELECT COUNT(*) FROM tag_roles", [], |r| r.get(0))?;
    if roles == 0 && claims == 0 {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch("UPDATE tags SET is_type = 1 WHERE id IN (SELECT tag_id FROM roles)")?;
    tx.execute_batch(
        "INSERT OR IGNORE INTO tag_links(tag_id, target_type, target_id)
         SELECT tr.tag_id, 'type', r.tag_id
         FROM tag_roles tr JOIN roles r ON r.id = tr.role_id",
    )?;
    tx.commit()?;
    eprintln!(
        "迁移 021:roles/tag_roles 搬进标签系统 —— 登记类型 {roles} 个、类型认领 {claims} 条(旧表随后删除)"
    );
    Ok(())
}

/// 确保 `tags.is_type` 存在且默认 0;重放时是空操作。
pub(crate) fn ensure_is_type_column(conn: &Connection) -> rusqlite::Result<()> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('tags') WHERE name = 'is_type'",
        [],
        |r| r.get(0),
    )?;
    if n == 0 {
        conn.execute_batch(
            "ALTER TABLE tags ADD COLUMN is_type INTEGER NOT NULL DEFAULT 0",
        )?;
    }
    Ok(())
}

/// 022 删除 `tags.is_type`(设计 2026-10-06 §2:「谁能当类型」这条约束取消,任何标签都能被指向)。
/// 与 021 的 ADD COLUMN 同理:SQLite 的 `ALTER TABLE ... DROP COLUMN` 没有 IF EXISTS,
/// 重放会报 no such column,故按列存在性决定是否执行。
/// 列上没有索引/触发器/生成列引用,`DROP COLUMN` 直接可用(不重建表、不触发 tag_links 级联)。
pub(crate) const RELATIONS_VERSION: i64 = 22;

pub(crate) fn drop_is_type_column(conn: &Connection) -> rusqlite::Result<()> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('tags') WHERE name = 'is_type'",
        [],
        |r| r.get(0),
    )?;
    if n > 0 {
        conn.execute_batch("ALTER TABLE tags DROP COLUMN is_type")?;
    }
    Ok(())
}

/// 023 给 `tag_links` 加 `remark`(属性名存在**边**上,设计 2026-10-06 §2 修订)。
/// 与 021 的 ADD COLUMN 同一限制:SQLite 没有 IF NOT EXISTS,重放会报 duplicate column,
/// 故按列存在性决定是否执行。存量行取默认空串(显示回退只给目标名,不校验历史数据)。
pub(crate) const LINK_REMARK_VERSION: i64 = 23;

pub(crate) fn ensure_link_remark_column(conn: &Connection) -> rusqlite::Result<()> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('tag_links') WHERE name = 'remark'",
        [],
        |r| r.get(0),
    )?;
    if n == 0 {
        conn.execute_batch("ALTER TABLE tag_links ADD COLUMN remark TEXT NOT NULL DEFAULT ''")?;
    }
    Ok(())
}
