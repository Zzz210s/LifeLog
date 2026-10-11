//! 标签关系写命令层(T3.2 自 tags.rs 拆出以守 200 行上限):只做参数转发,不写 SQL。
//! 命令名 `set_tag_relation` 与参数形状自 v30 起冻结(前端零改调用);新增
//! `rename_line_name` / `create_line` / `remove_line`(spec §8.1),`remove_tag_relation`
//! 增可选第 3 参 `nameId`。
use crate::db::repos::tags;
use tauri::AppHandle;

use super::tags::with_conn;

/// 建立标签关系 A -> B(幂等):自指向 / 成环 / 标签不存在都给中文错且不写库。
/// 任何标签都可被指向(设计 2026-10-06 R2:is_type 已取消)
/// `remark` 是**关系名文本**(可空 = 只声明有关系);已存在同向线时只改名字,不新增线
/// (空串 = 清除名字,该线回无名字线)。
#[tauri::command]
pub fn set_tag_relation(
    app: AppHandle,
    from_tag: i64,
    to_tag: i64,
    remark: String,
) -> Result<(), String> {
    with_conn(&app, |c| tags::set_tag_relation(c, from_tag, to_tag, &remark))
}

/// 移除标签关系 A -> B(幂等:不存在也算成功)。可选第 3 参 `nameId`:
/// 给了就只删那条有名线,不给只删无名字线(一对多点可有多条线,spec §8.1)。
#[tauri::command]
pub fn remove_tag_relation(
    app: AppHandle,
    from_tag: i64,
    to_tag: i64,
    name_id: Option<i64>,
) -> Result<(), String> {
    with_conn(&app, |c| tags::remove_tag_relation(c, from_tag, to_tag, name_id))
}

/// 改名一个关系名点:改点 `meta`,引用它的每条线的名字文本一起变;撞名给中文错。
#[tauri::command]
pub fn rename_line_name(app: AppHandle, name_id: i64, new_name: String) -> Result<(), String> {
    with_conn(&app, |c| tags::rename_line_name(c, name_id, &new_name))
}

/// 细粒度建一条线,返回新线 id;`name_id` 省略 = 无名字线,重复线给中文错。
#[tauri::command]
pub fn create_line(
    app: AppHandle,
    from_id: i64,
    to_id: i64,
    name_id: Option<i64>,
) -> Result<i64, String> {
    with_conn(&app, |c| tags::create_line(c, from_id, to_id, name_id))
}

/// 按 id 删一条线(幂等)。
#[tauri::command]
pub fn remove_line(app: AppHandle, line_id: i64) -> Result<(), String> {
    with_conn(&app, |c| tags::remove_line(c, line_id).map_err(|e| e.to_string()))
}
