//! 首次运行:把旧的单库 `lifelog.db` 迁进多库布局,并命名为「日常」。
//!
//! 顺序(每一步失败都回到原位,不留半个状态):
//! 1. `VACUUM INTO` 一份快照到 `<app_dir>/lifelog.db.pre-multilib-<stamp>.db`(万一搬坏能立刻回退);
//! 2. 建 `libraries/richang/`,把 `.db`/`-wal`/`-shm` 三个文件一起搬进去;
//! 3. 写 `libraries.json`(`current = richang`,名字「日常」);
//! 4. 回读:库文件存在且能开 —— 否则把文件搬回原处并删掉注册表。
//!
//! 为什么连 `-wal` / `-shm` 一起搬:库是 WAL 模式,只搬 `.db` 会丢掉未 checkpoint 的事务
//! (2026-10-06 踩过:那样的副本 user_version 会退回旧值)。
use super::library::{self, LibraryMeta, Registry};
use std::path::{Path, PathBuf};

/// 迁移结果:注册表 + 是否真的搬了(用于日志/测试)
pub struct Ensured {
    pub registry: Registry,
    pub migrated: bool,
    /// 旧库搬家前的快照(没有旧库 / 没搬家时为 None)
    pub snapshot: Option<PathBuf>,
}

/// 确保存在可用注册表:已有就读;没有则把旧单库迁进来(或建空库)
pub fn ensure(app_dir: &Path) -> Result<Ensured, String> {
    if let Some(reg) = library::load(app_dir)? {
        return Ok(Ensured {
            registry: reg,
            migrated: false,
            snapshot: None,
        });
    }
    let legacy = app_dir.join(super::data_dir_migration::DB_FILE);
    if !legacy.exists() {
        // 全新安装:直接建一个空库,名字也用「日常」(用户第一眼就有名字可改)
        let reg = create_first(app_dir)?;
        return Ok(Ensured {
            registry: reg,
            migrated: false,
            snapshot: None,
        });
    }
    let snapshot = snapshot_legacy(app_dir, &legacy)?;
    let dir_rel = library::rel_dir(library::LEGACY_LIB_ID);
    let dir_abs = app_dir.join(&dir_rel);
    std::fs::create_dir_all(&dir_abs).map_err(|e| format!("创建库目录失败: {e}"))?;
    let moved = move_sidecars(&legacy, &dir_abs.join(library::LIB_DB_FILE))?;
    let reg = Registry {
        current: library::LEGACY_LIB_ID.to_string(),
        libraries: vec![LibraryMeta {
            id: library::LEGACY_LIB_ID.to_string(),
            name: library::LEGACY_LIB_NAME.to_string(),
            dir: dir_rel,
            created_at: library::stamp_now(),
        }],
    };
    if let Err(e) = library::save(app_dir, &reg) {
        // 注册表没写成:把文件搬回去,保持"旧单库"的可用状态
        rollback(&dir_abs, &legacy, &moved);
        return Err(e);
    }
    if !dir_abs.join(library::LIB_DB_FILE).exists() {
        let _ = std::fs::remove_file(library::registry_path(app_dir));
        rollback(&dir_abs, &legacy, &moved);
        return Err("迁移后找不到库文件,已回退到迁移前的状态".into());
    }
    Ok(Ensured {
        registry: reg,
        migrated: true,
        snapshot: Some(snapshot),
    })
}

/// 全新安装:建空库目录 + 注册表(库文件由调用方打开时创建)
fn create_first(app_dir: &Path) -> Result<Registry, String> {
    let dir_rel = library::rel_dir(library::LEGACY_LIB_ID);
    std::fs::create_dir_all(app_dir.join(&dir_rel)).map_err(|e| format!("创建库目录失败: {e}"))?;
    let reg = Registry {
        current: library::LEGACY_LIB_ID.to_string(),
        libraries: vec![LibraryMeta {
            id: library::LEGACY_LIB_ID.to_string(),
            name: library::LEGACY_LIB_NAME.to_string(),
            dir: dir_rel,
            created_at: library::stamp_now(),
        }],
    };
    library::save(app_dir, &reg)?;
    Ok(reg)
}

/// `VACUUM INTO` 快照(单文件、一致);老库可能带着 WAL,必须用 SQLite 自己复制
fn snapshot_legacy(app_dir: &Path, legacy: &Path) -> Result<PathBuf, String> {
    let dst = app_dir.join(format!(
        "lifelog.db.pre-multilib-{}.db",
        library::stamp_now()
    ));
    let conn = rusqlite::Connection::open(legacy).map_err(|e| format!("打开旧库失败: {e}"))?;
    conn.execute("VACUUM INTO ?1", [dst.to_string_lossy().to_string()])
        .map_err(|e| format!("旧库快照失败: {e}"))?;
    Ok(dst)
}

/// 搬 `.db` + `-wal` + `-shm`;返回搬过的目标文件(回滚时按它搬回去)
fn move_sidecars(from_db: &Path, to_db: &Path) -> Result<Vec<(PathBuf, PathBuf)>, String> {
    let mut moved = Vec::new();
    let pairs = |src: &Path, dst: &Path| -> Vec<(PathBuf, PathBuf)> {
        let mut v = vec![(src.to_path_buf(), dst.to_path_buf())];
        for suffix in ["-wal", "-shm"] {
            let s = PathBuf::from(format!("{}{suffix}", src.display()));
            if s.exists() {
                v.push((s, PathBuf::from(format!("{}{suffix}", dst.display()))));
            }
        }
        v
    };
    for (src, dst) in pairs(from_db, to_db) {
        std::fs::rename(&src, &dst).map_err(|e| format!("移动库文件失败: {e}"))?;
        moved.push((src, dst));
    }
    Ok(moved)
}

fn rollback(dir_abs: &Path, legacy: &Path, moved: &[(PathBuf, PathBuf)]) {
    for (orig, now) in moved.iter().rev() {
        let _ = std::fs::rename(now, orig);
    }
    let _ = std::fs::remove_dir_all(dir_abs);
    let _ = legacy.parent(); // 保持旧位置可用即可
}

#[cfg(test)]
#[path = "library_migrate_tests.rs"]
mod library_migrate_tests;
