//! 多库 IPC(2026-10-26):列表 / 新建 / 重命名 / 删除 / 切换 / 当前库。
//!
//! 切换是**换连接**:持锁把 `Db` 里的 `Connection` 换成新库的;返回后前端让所有窗口重载。
//! 删除/重命名只动注册表与目录,不动别的库。当前库不允许删除(否则应用起来没有落点)。
use crate::db::library::{self, Registry};
use crate::db::Db;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryList {
    pub current: String,
    pub libraries: Vec<library::LibraryMeta>,
}

fn app_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("定位应用数据目录失败: {e}"))
}

fn load(app: &AppHandle) -> Result<Registry, String> {
    library::load(&app_dir(app)?)?.ok_or_else(|| "库列表还没初始化".to_string())
}

/// 全部库 + 当前库 id(顶栏与设置页的数据源)
#[tauri::command]
pub fn list_libraries(app: AppHandle) -> Result<LibraryList, String> {
    let reg = load(&app)?;
    Ok(LibraryList {
        current: reg.current,
        libraries: reg.libraries,
    })
}

/// 新建空库(只有默认筛选与保留点;不复制当前库的标签)
#[tauri::command]
pub fn create_library(app: AppHandle, name: String) -> Result<library::LibraryMeta, String> {
    let dir = app_dir(&app)?;
    let mut reg = load(&app)?;
    let name = library::normalize_name(&name)?;
    if reg.find_by_name(&name).is_some() {
        return Err(format!("已经有叫「{name}」的库了"));
    }
    let id = library::new_lib_id(&reg.libraries);
    let rel = library::rel_dir(&id);
    std::fs::create_dir_all(dir.join(&rel)).map_err(|e| format!("创建库目录失败: {e}"))?;
    // 建空库并跑迁移:失败就把目录删掉,不留半个库
    let meta = library::LibraryMeta {
        id,
        name,
        dir: rel,
        created_at: library::stamp_now(),
    };
    if let Err(e) = crate::db::open(&library::db_path(&dir, &meta)) {
        let _ = std::fs::remove_dir_all(dir.join(&meta.dir));
        return Err(e.reason);
    }
    reg.libraries.push(meta.clone());
    library::save(&dir, &reg)?;
    Ok(meta)
}

/// 重命名(只改显示名;目录名不动,避免路径失效)
#[tauri::command]
pub fn rename_library(app: AppHandle, id: String, name: String) -> Result<LibraryList, String> {
    let dir = app_dir(&app)?;
    let mut reg = load(&app)?;
    let name = library::normalize_name(&name)?;
    if let Some(other) = reg.find_by_name(&name) {
        if other.id != id {
            return Err(format!("已经有叫「{name}」的库了"));
        }
    }
    let lib = reg
        .libraries
        .iter_mut()
        .find(|l| l.id == id)
        .ok_or_else(|| "找不到这个库".to_string())?;
    lib.name = name;
    library::save(&dir, &reg)?;
    Ok(LibraryList {
        current: reg.current,
        libraries: reg.libraries,
    })
}

/// 删除库(当前库不可删;目录整个删掉,先写一份快照到库目录旁)
#[tauri::command]
pub fn delete_library(app: AppHandle, id: String) -> Result<LibraryList, String> {
    let dir = app_dir(&app)?;
    let mut reg = load(&app)?;
    if reg.current == id {
        return Err("不能删除正在使用的库,请先切换到别的库".into());
    }
    let lib = reg
        .find(&id)
        .cloned()
        .ok_or_else(|| "找不到这个库".to_string())?;
    if reg.libraries.len() <= 1 {
        return Err("至少要保留一个库".into());
    }
    // 删目录前先把库 VACUUM INTO 成一份单文件快照,放在同级,方便用户反悔
    let db = library::db_path(&dir, &lib);
    if db.exists() {
        let snap = dir.join(format!("deleted-{}-{}.db", lib.id, library::stamp_now()));
        if let Ok(conn) = rusqlite::Connection::open(&db) {
            let _ = conn.execute("VACUUM INTO ?1", [snap.to_string_lossy().to_string()]);
        }
    }
    std::fs::remove_dir_all(dir.join(&lib.dir)).map_err(|e| format!("删除库目录失败: {e}"))?;
    reg.libraries.retain(|l| l.id != id);
    library::save(&dir, &reg)?;
    Ok(LibraryList {
        current: reg.current,
        libraries: reg.libraries,
    })
}

/// 切库:换连接 + 更新注册表的 current;失败时保持原连接不变
#[tauri::command]
pub fn switch_library(app: AppHandle, db: State<'_, Db>, id: String) -> Result<LibraryList, String> {
    let dir = app_dir(&app)?;
    let mut reg = load(&app)?;
    let lib = reg
        .find(&id)
        .cloned()
        .ok_or_else(|| "找不到这个库".to_string())?;
    let path = library::db_path(&dir, &lib);
    let report = crate::db::open(&path).map_err(|e| e.reason)?;
    crate::commands::startup::heal_reserved_name_point(&report.conn)?;
    {
        let mut guard = db.0.lock().map_err(|e| e.to_string())?;
        *guard = report.conn; // 换连接:旧连接随赋值释放
    }
    reg.current = id;
    library::save(&dir, &reg)?;
    Ok(LibraryList {
        current: reg.current,
        libraries: reg.libraries,
    })
}
