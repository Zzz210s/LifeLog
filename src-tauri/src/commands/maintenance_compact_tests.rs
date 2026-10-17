//! ① 重建收尾(`optimize` + `VACUUM`)的回归(自 maintenance_tests.rs 拆出,守 200 行上限):
//! 段整理真的合并了 FTS 段、第二次重建不再膨胀、`VACUUM` 把空闲页还给文件系统。
//! 两个断言都落在**真实文件库**上:文件字节与 `page_count` 在 `:memory:` 上没有意义。
//! `dbstat` 虚拟表由 bundled SQLite 编入(`SQLITE_ENABLE_DBSTAT_VTAB`,libsqlite3-sys build.rs)。
use super::*;
use crate::db::migrate;
use rusqlite::Connection;
use std::path::{Path, PathBuf};

/// 独立临时库路径:同一次测试进程内多次调用也不撞名。
fn temp_db(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let mut p = std::env::temp_dir();
    p.push(format!("lifelog-test-{tag}-{}-{nanos}.db", std::process::id()));
    p
}

/// 清理主文件与 WAL/SHM 边车(Windows 上文件被打开时删不掉,调用方先 drop 连接)。
fn cleanup(path: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
    }
}

/// 灌入 `rows` 篇内容点,分 `batches` 条语句提交(每条语句 = FTS5 的一个段)。
/// 正文够长才让段开销落在页粒度上看得到。
fn seed(c: &Connection, rows: i64, batches: i64) {
    let per = (rows + batches - 1) / batches;
    let mut id = 1000i64;
    while id < 1000 + rows {
        let mut batch = String::new();
        for _ in 0..per.min(1000 + rows - id) {
            batch.push_str(&format!(
                "INSERT INTO points(id, meta, created_at) VALUES({id}, \
                 '第 {id} 篇笔记的正文内容足够长，用来把三元组索引撑到多个段', '2026-01-01');"
            ));
            id += 1;
        }
        c.execute_batch(&batch).unwrap();
    }
}

/// 全部 FTS 影子对象占的字节(dbstat 按页计,页粒度即文件粒度)。
fn fts_bytes(c: &Connection) -> i64 {
    c.query_row(
        "SELECT COALESCE(SUM(pgsize), 0) FROM dbstat WHERE name LIKE 'points_fts%'",
        [],
        |r| r.get(0),
    )
    .unwrap()
}

fn page_count(c: &Connection) -> i64 {
    c.query_row("PRAGMA page_count", [], |r| r.get(0)).unwrap()
}

/// 段整理:`optimize` 必须把「多次写入 + 批量删除」留下的段与墓碑合并掉,体积降下来;
/// 紧接着第二次重建不得再膨胀(没有 `optimize` 时 DELETE 的墓碑会逐轮叠加)。
#[test]
fn rebuild_merges_fts_segments_and_second_run_does_not_grow() {
    let path = temp_db("fts-compact");
    let c = Connection::open(&path).unwrap();
    migrate::run(&c).unwrap();
    seed(&c, 450, 15);
    // 删掉一大半:留下 FTS 墓碑与空闲页,正是真库体检里的膨胀来源
    c.execute("DELETE FROM points WHERE id > 1250", []).unwrap();

    let before = fts_bytes(&c);
    let first_written = rebuild(&c).unwrap();
    let first = fts_bytes(&c);
    assert!(first < before, "段整理必须让 FTS 体积下降({before} -> {first})");

    let second_written = rebuild(&c).unwrap();
    let second = fts_bytes(&c);
    assert_eq!(second_written, first_written, "重建行数不变");
    assert!(second <= first, "第二次重建不得让 FTS 继续膨胀({first} -> {second})");

    drop(c);
    cleanup(&path);
}

/// `VACUUM`:删数据留下的空闲页必须还给文件系统(没有 `VACUUM` 时 `page_count` 原地不动)。
#[test]
fn rebuild_vacuums_free_pages_out_of_the_file() {
    let path = temp_db("vacuum");
    let c = Connection::open(&path).unwrap();
    migrate::run(&c).unwrap();
    seed(&c, 450, 1);
    c.execute("DELETE FROM points WHERE id > 1250", []).unwrap();

    let before = page_count(&c);
    let freelist: i64 = c.query_row("PRAGMA freelist_count", [], |r| r.get(0)).unwrap();
    assert!(freelist > 0, "前置:删行必须留下空闲页({freelist})");

    rebuild(&c).unwrap();
    let after = page_count(&c);
    assert!(after < before, "VACUUM 必须把空闲页还给文件({before} -> {after})");

    drop(c);
    cleanup(&path);
}
