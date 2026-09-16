//! 自建视图仓库层(MVP-3 Task 2):CRUD、拖拽排序与批量命中计数。
//! 内置视图(全部/待办/无自定义标签)是代码常量不入表,永久置顶且不可改名/删除/排序;
//! 自建视图存「标题 + 条件 JSON + 排序」,写库前先校验条件,坏条件不落库。
//! 读取时附带 `broken_paths`(表达式引用的失效标签路径,Task 4);命中计数拆在 views_hits.rs,
//! 失效路径计算拆在 views_expr_broken.rs,本文件守 200 行上限。
use rusqlite::{params, Connection};
use serde::Serialize;

use super::notes::notes_filter::TagCond;
use super::notes::{validate_conditions, FilterConditions};

/// 批量命中计数(实现见 views_hits.rs;此处 re-export 保持 `views::hit_counts` 调用路径)
#[path = "views_hits.rs"]
mod views_hits;
pub use views_hits::hit_counts;

/// 表达式失效路径检测(实现见 views_expr_broken.rs)
#[path = "views_expr_broken.rs"]
mod views_expr_broken;

/// 标题上限(字符数,含两侧去空白后)与视图总数上限
const MAX_TITLE_CHARS: usize = 40;
const MAX_VIEWS: i64 = 50;

/// 自建视图(表 saved_views 的一行);conditions 为共享条件对象,
/// `broken_paths` 是表达式引用但当前库中已不存在的标签路径(无表达式/无失效时为空数组)
#[derive(Debug, Serialize)]
pub struct SavedView {
    pub id: i64,
    pub title: String,
    pub conditions: FilterConditions,
    pub sort_order: i64,
    pub created_at: String,
    pub broken_paths: Vec<String>,
}

/// 内置视图描述(key 与中文标题)。命令层暂不透出(前端按约定自带常量),
/// 作为 Task 3/4 可引用的接口形状保留。
#[allow(dead_code)]
pub struct BuiltinView {
    pub key: &'static str,
    pub title: &'static str,
}

/// 内置三视图(key, 中文标题):全部 / 待办 / 无自定义标签。
/// 「无自定义标签」= **时间子树之外没有任何标签**(时间标签是系统元数据,不算用户的归类),
/// 回填/新建后所有笔记都带时间标签,故不能再用"有没有 tag_links"来判。
/// 标题真源在前端 `builtin-views.ts`(此处标题仅作占位/排障用途,不透出给界面)。
pub fn builtins() -> Vec<(&'static str, &'static str)> {
    vec![("all", "全部"), ("todo", "待办"), ("untagged", "无自定义标签")]
}

/// 内置视图的条件:待办 = 引入 `todo`(精确)+ 排除 `done`(精确);
/// 无自定义标签 = tagPresence none(谓词已排除时间子树,见 `notes_filter::has_custom_tag`);
/// 全部与未知 key 一律回退空条件(全部)。
pub fn conditions_of_builtin(key: &str) -> FilterConditions {
    let exact = |p: &str| TagCond { path: p.into(), include_children: false };
    match key {
        "todo" => FilterConditions {
            tags: vec![exact("todo")],
            exclude_tags: vec![exact("done")],
            ..FilterConditions::default()
        },
        "untagged" => FilterConditions {
            tag_presence: Some("none".into()),
            ..FilterConditions::default()
        },
        _ => FilterConditions::default(),
    }
}

/// 标题校验:非空(去空白)、不超上限、不与其他视图重名(exclude_id 供改名时排除自己)。
/// 通过则返回去空白后的标题。
fn check_title(conn: &Connection, title: &str, exclude_id: Option<i64>) -> Result<String, String> {
    let t = title.trim();
    if t.is_empty() {
        return Err("视图名称不能为空".into());
    }
    if t.chars().count() > MAX_TITLE_CHARS {
        return Err(format!("视图名称最多 {MAX_TITLE_CHARS} 字"));
    }
    // exclude_id 为 NULL 时不过滤 id,任何同名行都算重名
    let dup: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM saved_views WHERE title = ?1 AND (?2 IS NULL OR id <> ?2)",
            params![t, exclude_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if dup > 0 {
        return Err("已有同名视图".into());
    }
    Ok(t.to_string())
}

/// 全部自建视图,按 sort_order(并列按 created_at、id)升序;
/// 先一次取全量标签路径,再逐视图标出表达式里的失效引用
pub fn list(conn: &Connection) -> Result<Vec<SavedView>, String> {
    let known = views_expr_broken::known_paths(conn)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, conditions, sort_order, created_at FROM saved_views
             ORDER BY sort_order, created_at, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?, r.get::<_, String>(4)?))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let (id, title, json, sort_order, created_at) = row.map_err(|e| e.to_string())?;
        let conditions: FilterConditions = serde_json::from_str(&json)
            .map_err(|e| format!("视图「{title}」的条件数据无法解析: {e}"))?;
        let broken_paths = views_expr_broken::of(conditions.expr.as_deref(), &known);
        out.push(SavedView { id, title, conditions, sort_order, created_at, broken_paths });
    }
    Ok(out)
}

/// 新建视图(追加到排序末尾);写库前先校验条件与标题,总数超上限拒绝
pub fn create(conn: &Connection, title: &str, c: &FilterConditions) -> Result<i64, String> {
    validate_conditions(c)?;
    let title = check_title(conn, title, None)?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM saved_views", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if count >= MAX_VIEWS {
        return Err(format!("视图最多保存 {MAX_VIEWS} 个"));
    }
    let json = serde_json::to_string(c).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO saved_views(title, conditions, sort_order, created_at)
         VALUES(?1, ?2, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM saved_views),
                datetime('now', 'localtime'))",
        params![title, json],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

/// 改名并整体替换条件;视图不存在时报错
pub fn update(conn: &Connection, id: i64, title: &str, c: &FilterConditions) -> Result<(), String> {
    validate_conditions(c)?;
    let title = check_title(conn, title, Some(id))?;
    let json = serde_json::to_string(c).map_err(|e| e.to_string())?;
    let n = conn
        .execute(
            "UPDATE saved_views SET title=?2, conditions=?3 WHERE id=?1",
            params![id, title, json],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("视图不存在,可能已被删除".into());
    }
    Ok(())
}

/// 删除视图;视图不存在时报错
pub fn remove(conn: &Connection, id: i64) -> Result<(), String> {
    let n = conn
        .execute("DELETE FROM saved_views WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("视图不存在,可能已被删除".into());
    }
    Ok(())
}

/// 拖拽排序:ids 必须恰为全部自建视图的一次重排(整批校验后重写 sort_order 为 0..n-1)。
/// 单事务:校验与重写要么全部生效、要么全不生效。
pub fn reorder(conn: &mut Connection, ids: &[i64]) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let existing = {
        let mut stmt = tx.prepare("SELECT id FROM saved_views").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| r.get::<_, i64>(0)).map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<i64>>>().map_err(|e| e.to_string())?
    };
    let mut given = ids.to_vec();
    given.sort_unstable();
    let mut current = existing;
    current.sort_unstable();
    if given != current {
        return Err("排序清单必须恰好包含全部自建视图".into());
    }
    for (i, id) in ids.iter().enumerate() {
        tx.execute("UPDATE saved_views SET sort_order=?2 WHERE id=?1", params![id, i as i64])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "views_tests.rs"]
mod views_tests;
