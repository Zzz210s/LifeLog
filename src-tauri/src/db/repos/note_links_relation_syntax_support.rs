//! 设计 §6.2 映射表 19 行的夹具与断言(2026-10-15 T3)。
//! 前置一律用原生 SQL 造点/线:树内目标写全 `parent_id`(写路径 `existing_id` 按 `parent_id`
//! 逐段寻址,不读 `path`);名字点按字面 `meta` 直造 —— 于是「保存前的状态」逐字节可控。
//! 夹具里另有一条**旁证来源** 91 的线指向三个目标点:否则没有线的树内目标点会
//! 在收尾 `gc_orphans` 里被当空壳回收(既有行为,本任务的语义不涉及它)。
use crate::db::migrate;
use crate::db::repos::notes::{update, Note};
use rusqlite::{params, Connection};

/// 来源笔记点(树外:`path IS NULL`)与三个目标点 id
pub(super) const SRC: i64 = 90;
pub(super) const JAPAN: i64 = 12;
pub(super) const CHINA: i64 = 13;

/// 内存库 + 全部迁移 + 外键(线两端有 `ON DELETE CASCADE`)+ 下面的前置状态
pub(super) fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrate::run(&c).unwrap();
    seed(&c);
    c
}

/// 树 `地点/{日本,中国}`、树 `状态/未完成`、来源 90、旁证来源 91 与链接目标 92
fn seed(c: &Connection) {
    c.execute_batch(
        "INSERT INTO points(id, meta, created_at, path, parent_id, depth) VALUES
           (10, '地点', '2026-01-01', '地点', NULL, 1),
           (12, '日本', '2026-01-01', '地点/日本', 10, 2),
           (13, '中国', '2026-01-01', '地点/中国', 10, 2),
           (11, '状态', '2026-01-01', '状态', NULL, 1),
           (14, '未完成', '2026-01-01', '状态/未完成', 11, 2),
           (90, '正文', '2026-01-01', NULL, NULL, NULL),
           (91, '旁证', '2026-01-01', NULL, NULL, NULL),
           (92, '链接目标', '2026-01-01', NULL, NULL, NULL);
         INSERT INTO lines(from_id, to_id, name_id, created_at) VALUES
           (91, 12, NULL, '2026-01-01'), (91, 13, NULL, '2026-01-01'), (91, 14, NULL, '2026-01-01');",
    )
    .unwrap();
}

/// 直造一个**名字点**(`path` / `parent_id` 皆 NULL 的树外点),`meta` 逐字节给定
pub(super) fn name_point(c: &Connection, meta: &str) -> i64 {
    c.execute(
        "INSERT INTO points(meta, is_cited, created_at) VALUES(?1, 0, '2026-01-01')",
        params![meta],
    )
    .unwrap();
    c.last_insert_rowid()
}

/// 给来源 90 造一条前置线,返回线 id
pub(super) fn line(c: &Connection, to: i64, name: Option<i64>) -> i64 {
    c.query_row(
        "INSERT INTO lines(from_id, to_id, name_id, created_at) VALUES(?1, ?2, ?3, '2026-01-01')
         RETURNING id",
        params![SRC, to, name],
        |r| r.get(0),
    )
    .unwrap()
}

/// 走真实保存漏斗(解析 -> 目标/名字点解析 -> 落库),返回读回的笔记
pub(super) fn save(c: &mut Connection, content: &str) -> Note {
    update(c, SRC, content).unwrap().expect("来源点 90 存在")
}

/// 保存并返回来源的期望线表形状(§6.2 右两列的「期望结果」)
pub(super) fn after(c: &mut Connection, content: &str) -> Vec<(i64, Option<i64>)> {
    save(c, content);
    pairs(c)
}

/// 保存后断言 `to` 是一条名线,返回它的名字点 id(名字组落地的那类行都用它)
pub(super) fn after_named(c: &mut Connection, content: &str, to: i64) -> i64 {
    save(c, content);
    name_id_of(c, to).expect("名线")
}

/// 来源 90 的全部非子级线 `(线 id, 目标, 名字点)`(按线 id):验「线 id 不变」用它
pub(super) fn rows(c: &Connection) -> Vec<(i64, i64, Option<i64>)> {
    let mut stmt = c
        .prepare(
            "SELECT id, to_id, name_id FROM lines
              WHERE from_id = ?1 AND (name_id IS NULL OR name_id <> 0) ORDER BY id",
        )
        .unwrap();
    let out = stmt
        .query_map(params![SRC], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    out
}

/// 来源 90 的当前线表 `(目标, 名字点)`(按目标升序):期望线表形状,走生产读法 `current_lines`
pub(super) fn pairs(c: &Connection) -> Vec<(i64, Option<i64>)> {
    let mut out = crate::db::repos::note_links::current_lines(c, SRC).unwrap();
    out.sort();
    out
}

/// 指向某目标的唯一一条线的名字点(没有线返回 None;多条线的目标用 [`pairs`])
pub(super) fn name_id_of(c: &Connection, to: i64) -> Option<i64> {
    let hit: Vec<Option<i64>> =
        rows(c).into_iter().filter(|(_, t, _)| *t == to).map(|(_, _, n)| n).collect();
    assert_eq!(hit.len(), 1, "目标 {to} 应当只有一条线");
    hit[0]
}

/// 库里 `meta` 逐字节相等、且不在树内的点 id(名字点判据:名字点 `path` 为 NULL)
pub(super) fn named_ids(c: &Connection, meta: &str) -> Vec<i64> {
    let mut stmt =
        c.prepare("SELECT id FROM points WHERE meta = ?1 AND path IS NULL ORDER BY id").unwrap();
    let out =
        stmt.query_map(params![meta], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
    out
}

/// 点 id 的 `meta`(断言名字点文本)与 `path`(断言自动建树)
pub(super) fn meta_of(c: &Connection, id: i64) -> String {
    c.query_row("SELECT meta FROM points WHERE id = ?1", params![id], |r| r.get(0)).unwrap()
}

pub(super) fn path_of(c: &Connection, id: i64) -> Option<String> {
    c.query_row("SELECT path FROM points WHERE id = ?1", params![id], |r| r.get(0)).unwrap()
}
