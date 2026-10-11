//! 保留名字点 `子级`(id = [`TREE_NAME_ID`])的体检、自愈与恢复(spec §6.2)。
//!
//! 风险:该点被删会经 `lines.name_id ON DELETE CASCADE` 连带删掉 719 条子级线,
//! 而 `parent_id / path / depth` 缓存还在 —— 树看着照旧,「入树」判据与对账 ②/⑤/⑨ 全崩。
//! 三层防护:命令层拒绝删除、启动期自愈检查(本模块)、以及只依赖 `parent_id` 缓存的恢复算法。
//! `path` 只是显示缓存,恢复期间一律不读它。

use rusqlite::{Connection, OptionalExtension};

use crate::db::repos::settings;

/// 保留名字点 `子级` 的固定 id(spec §14 P1 / 计划 P0-1):真库点 id 从 1 起,0 可用。
/// 迁移 031 的前置钩子与本模块共用这一处真源。
pub const TREE_NAME_ID: i64 = 0;

/// 保留点的 `meta`。记录性文本,不是判据(spec §6.1):判据一律用 id。
const TREE_NAME_META: &str = "子级";

/// 一次自愈的读数。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RepairReport {
    /// 本次新建了保留点(点还在、只是线丢了时为 false)
    pub point_created: bool,
    /// 找回 / 改写的子级线数
    pub lines_fixed: usize,
}

impl RepairReport {
    /// 是否动过库(健康库应为 false)。
    pub fn changed(&self) -> bool {
        self.point_created || self.lines_fixed > 0
    }

    /// 日志用的一句话读数。
    pub fn message(&self) -> String {
        format!(
            "{}保留点,找回子级线 {} 条",
            if self.point_created { "新建" } else { "复用" },
            self.lines_fixed
        )
    }
}

fn reserved_error(msg: String) -> rusqlite::Error {
    rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(1), Some(msg))
}

/// 确保保留点存在:缺失即建(返回 true);`id = TREE_NAME_ID` 被非保留点占用时报错
/// (不静默覆盖)。与迁移 031 前置钩子的插入语句同形。
pub fn ensure_reserved_name_point(conn: &Connection) -> rusqlite::Result<bool> {
    let occupant: Option<String> = conn
        .query_row("SELECT meta FROM points WHERE id = ?1", [TREE_NAME_ID], |r| r.get(0))
        .optional()?;
    match occupant {
        Some(meta) if meta == TREE_NAME_META => Ok(false),
        Some(meta) => Err(reserved_error(format!(
            "id = {TREE_NAME_ID} 已被非保留点占用(meta = {meta:?}),不能建保留名字点 {TREE_NAME_META}"
        ))),
        None => {
            conn.execute(
                "INSERT INTO points(id, meta, is_cited, created_at, color, parent_id, path, depth, sort_order)
                 VALUES(?1, ?2, 0, datetime('now', 'localtime'), NULL, NULL, NULL, NULL, 0)",
                rusqlite::params![TREE_NAME_ID, TREE_NAME_META],
            )?;
            Ok(true)
        }
    }
}

/// 体检(spec §6.2 第二层防护):`settings.tree_line_name_id` 存在、可解析、指向一个
/// `meta = '子级'` 的点。`Ok(None)` = 健全;`Ok(Some(原因))` = 需自愈,原因直接给用户看。
/// 只读,不改库(自愈是 [`recover_tree_lines`] 的事)。
pub fn verify_reserved_name_point(conn: &Connection) -> rusqlite::Result<Option<String>> {
    let key = settings::TREE_LINE_NAME_ID_KEY;
    let Some(raw) = settings::get(conn, key)? else {
        return Ok(Some(format!("树线名字点缺失:settings.{key} 没有记录")));
    };
    if raw.trim().parse::<i64>().is_err() {
        return Ok(Some(format!("树线名字点记录不是合法 id:settings.{key} = {raw:?}")));
    }
    // 记录已确认合法,id 按规范读法取(助手带默认值,此处不会落到默认分支)
    let id = settings::tree_line_name_id(conn)?;
    let meta: Option<String> = conn
        .query_row("SELECT meta FROM points WHERE id = ?1", [id], |r| r.get(0))
        .optional()?;
    match meta {
        None => Ok(Some(format!("树线名字点缺失:settings.{key} 指向的点 {id} 不存在"))),
        Some(m) if m != TREE_NAME_META => Ok(Some(format!(
            "id = {id} 的点不是保留名字点(meta = {m:?},应为 {TREE_NAME_META:?})"
        ))),
        Some(_) => Ok(None),
    }
}

/// spec §6.2 恢复算法(只依赖 `parent_id` 缓存,不读 `path`):
/// 1. 保留点缺失即建;2. `settings.tree_line_name_id` 写回 [`TREE_NAME_ID`];
/// 3. 每个有父的点:同对的线还在、只是名字被清空则改写回 `name_id = TREE_NAME_ID`;
///    FK 级联把线一起删掉时,再按 `parent_id` 缓存补插。
pub fn recover_tree_lines(conn: &Connection) -> rusqlite::Result<RepairReport> {
    let point_created = ensure_reserved_name_point(conn)?;
    settings::set(conn, settings::TREE_LINE_NAME_ID_KEY, &TREE_NAME_ID.to_string())?;

    // 先改写:同对的线还在、只是名字被清空(例如误删后重放)时补回 id 0。
    // 已有 `name_id = 0` 的同对线时跳过 —— 唯一索引 (from_id,to_id,COALESCE(name_id,-1)) 不许两条同名线。
    let rewritten = conn.execute(
        "UPDATE lines SET name_id = ?1
          WHERE name_id IS NULL
            AND EXISTS(SELECT 1 FROM points p WHERE p.id = lines.to_id AND p.parent_id = lines.from_id)
            AND NOT EXISTS(SELECT 1 FROM lines l
                            WHERE l.from_id = lines.from_id AND l.to_id = lines.to_id AND l.name_id = ?1)",
        [TREE_NAME_ID],
    )?;

    // 再补插:级联删除会连 719 条子级线一起删掉,这一句按 parent_id 缓存重建。
    let inserted = conn.execute(
        "INSERT INTO lines(from_id, to_id, name_id, created_at)
         SELECT p.parent_id, p.id, ?1, datetime('now', 'localtime')
           FROM points p
          WHERE p.parent_id IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM lines l
                            WHERE l.from_id = p.parent_id AND l.to_id = p.id AND l.name_id = ?1)",
        [TREE_NAME_ID],
    )?;

    Ok(RepairReport { point_created, lines_fixed: rewritten + inserted })
}
