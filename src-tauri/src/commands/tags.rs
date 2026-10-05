//! 标签树命令层(MVP-2 Task 4):只做参数校验与转调仓库层,不写 SQL。
//! 删除前的影响面由独立的 `tag_impact` 提供(前端二次确认后再调 `delete_tag`)。
use crate::db::repos::carry_paths;
use crate::db::repos::tags::{self, CompleteItem, MergeReport, TagCount};
use crate::db::Db;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

/// 删除前的二次确认数据:将影响的子孙标签数、笔记数(已去重)与"被多少标签携带"
#[derive(Serialize, Debug, PartialEq)]
pub struct TagImpact {
    pub tags: i64,
    pub notes: i64,
    /// 该标签被多少个标签携带(删除确认文案;只数直接携带者)
    pub carriers: i64,
}

/// 取库连接并转调:锁中毒等基础设施错误统一转字符串
fn with_conn<T>(
    app: &AppHandle,
    f: impl FnOnce(&mut rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let db: State<Db> = app.state();
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    f(&mut conn)
}

/// 全部标签及本级/含子级计数(标签面板与筛选栏数据源)
#[tauri::command]
pub fn list_tags(app: AppHandle) -> Result<Vec<TagCount>, String> {
    with_conn(&app, |c| tags::counts(c).map_err(|e| e.to_string()))
}

/// 改名结果:本次自动登记为别名的旧名列表(D4;旧完整路径在前、叶子名在后)。
/// 前端调用点暂不使用该返回值(G3 标签菜单再接入),保留原命令名与参数不变。
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RenameReport {
    pub aliases: Vec<String>,
}

/// 改标签名(单段名称);级联重写子树路径与全文索引,并自动登记旧名为别名
#[tauri::command]
pub fn rename_tag(app: AppHandle, tag_id: i64, new_name: String) -> Result<RenameReport, String> {
    if new_name.trim().is_empty() {
        return Err("标签名不能为空".into());
    }
    with_conn(&app, |c| {
        tags::rename(c, tag_id, new_name.trim())
            .map(|aliases| RenameReport { aliases })
    })
}

/// 移动标签(含环检测);new_parent_id 为 null 表示移到根级
#[tauri::command]
pub fn move_tag(app: AppHandle, tag_id: i64, new_parent_id: Option<i64>) -> Result<(), String> {
    with_conn(&app, |c| tags::move_to(c, tag_id, new_parent_id))
}

/// 同级插入(S8):把标签移到锚点所在层,插到锚点之前(after=false)/之后(after=true)。
/// 新的父级由后端从锚点派生;同级重排与跨层拖拽走同一套校验与事务。
#[tauri::command]
pub fn move_tag_beside(
    app: AppHandle,
    tag_id: i64,
    anchor_id: i64,
    after: bool,
) -> Result<(), String> {
    with_conn(&app, |c| tags::move_beside(c, tag_id, anchor_id, after))
}

/// 删除子树(解除链接、回收空容器、重写全文索引);笔记永不因删标签而消失
#[tauri::command]
pub fn delete_tag(app: AppHandle, tag_id: i64) -> Result<(), String> {
    with_conn(&app, |c| tags::delete_subtree(c, tag_id))
}

/// 删除前的影响面读数(供二次确认弹窗)。carriers 只数指向该标签本身的直接携带者,
/// 不含指向其子孙的携带行 —— 删除子树会清掉后者,但读数不把它们算进 N。
#[tauri::command]
pub fn tag_impact(app: AppHandle, tag_id: i64) -> Result<TagImpact, String> {
    with_conn(&app, |c| {
        let (tags, notes) = tags::impact(c, tag_id).map_err(|e| e.to_string())?;
        let carriers = tags::count_carriers(c, tag_id).map_err(|e| e.to_string())?;
        Ok(TagImpact { tags, notes, carriers })
    })
}

/// 合并标签(G2):把 source 的笔记链接转移给 target,可选把 source 旧路径登记为 target 的别名,
/// 并级联改写当前筛选条件;返回转移读数(前端 G3 用它刷新树与筛选条件)。整事务,失败零变化。
#[tauri::command]
pub fn merge_tags(
    app: AppHandle,
    source_id: i64,
    target_id: i64,
    keep_alias: bool,
) -> Result<MergeReport, String> {
    with_conn(&app, |c| {
        tags::merge_tags(c, source_id, target_id, keep_alias)
    })
}

/// 该标签的全部别名(G3 spec §4):别名列表按 alias 升序,标签菜单展示与删除用
#[tauri::command]
pub fn list_tag_aliases(app: AppHandle, tag_id: i64) -> Result<Vec<String>, String> {
    with_conn(&app, |c| tags::list_for_tag(c, tag_id).map_err(|e| e.to_string()))
}

/// 手动登记别名:先校验目标标签存在(否则只会漏出 sqlite 的英文外键错),
/// 别名本身的合法性(非空/无空白/无 `#`/不与现有标签重名)由仓库层把关并给中文错
#[tauri::command]
pub fn add_tag_alias(app: AppHandle, alias: String, tag_id: i64) -> Result<(), String> {
    with_conn(&app, |c| {
        if !tags::tag_exists(c, tag_id).map_err(|e| e.to_string())? {
            return Err(format!("标签不存在: {tag_id}"));
        }
        tags::add(c, &alias, tag_id).map_err(|e| e.to_string())
    })
}

/// 删除别名(幂等:别名不存在也算成功)
#[tauri::command]
pub fn remove_tag_alias(app: AppHandle, alias: String) -> Result<(), String> {
    with_conn(&app, |c| tags::remove(c, &alias).map_err(|e| e.to_string()))
}

/// 添加标签携带关系(幂等):自携带 / 成环 / 标签不存在都给中文错且不写库
#[tauri::command]
pub fn set_tag_carry(app: AppHandle, carrier_id: i64, carried_id: i64) -> Result<(), String> {
    with_conn(&app, |c| tags::set_carry(c, carrier_id, carried_id))
}

/// 移除标签携带关系(幂等:不存在也算成功)
#[tauri::command]
pub fn remove_tag_carry(app: AppHandle, carrier_id: i64, carried_id: i64) -> Result<(), String> {
    with_conn(&app, |c| tags::remove_carry(c, carrier_id, carried_id))
}

/// 双向携带读数:carried = 本标签携带的;carriersOf = 携带本标签的(标签菜单「携带…」数据源)
#[tauri::command]
pub fn list_tag_carries(app: AppHandle, carrier_id: i64) -> Result<tags::CarryReport, String> {
    with_conn(&app, |c| tags::list_carries(c, carrier_id).map_err(|e| e.to_string()))
}

/// 有携带者的标签路径集合(去重、升序):条件栏摘要据此决定是否显示 `+携带` 小字
#[tauri::command]
pub fn carried_tag_paths(app: AppHandle) -> Result<Vec<String>, String> {
    with_conn(&app, |c| carry_paths::carried_paths(c).map_err(|e| e.to_string()))
}

/// 设置或取消「类型」标记(幂等):把该标签登记为类型(受控命名空间),**不动**树结构与排序(R5)
#[tauri::command]
pub fn set_tag_type_flag(app: AppHandle, tag_id: i64, is_type: bool) -> Result<(), String> {
    with_conn(&app, |c| tags::set_tag_type_flag(c, tag_id, is_type))
}

/// 整体替换某标签的类型认领(不是增量);type_ids 里的每一项必须是已登记的类型标签
#[tauri::command]
pub fn set_tag_types(app: AppHandle, tag_id: i64, type_ids: Vec<i64>) -> Result<(), String> {
    with_conn(&app, |c| tags::set_tag_types(c, tag_id, type_ids))
}

/// 全部已登记类型(标签菜单与筛选「类型」条件的数据源),按登记顺序
#[tauri::command]
pub fn list_types(app: AppHandle) -> Result<Vec<tags::TypeRef>, String> {
    with_conn(&app, |c| tags::list_types(c).map_err(|e| e.to_string()))
}

/// 全量标签「类型 / 携带」事实(一次 IPC 取全):侧栏逐标签读数会在扁平模式打 1.5k 次
#[tauri::command]
pub fn list_tag_facts(app: AppHandle) -> Result<tags::TagFactsBundle, String> {
    with_conn(&app, |c| tags::tag_facts(c).map_err(|e| e.to_string()))
}

/// 某标签认领的类型(标签菜单「类型…」回显),按路径升序
#[tauri::command]
pub fn list_tag_types(app: AppHandle, tag_id: i64) -> Result<Vec<tags::TypeRef>, String> {
    with_conn(&app, |c| tags::list_tag_types(c, tag_id).map_err(|e| e.to_string()))
}

/// 路径前缀补全(输入 `#工作/` 时列出下一级候选)。
/// 每项带 `kind`:"tag" 为标签路径命中,"alias" 为别名命中(前端在行尾标一个「别名」弱标记)。
#[tauri::command]
pub fn complete_tags(app: AppHandle, prefix: Option<String>) -> Result<Vec<CompleteItem>, String> {
    let prefix = prefix.unwrap_or_default();
    with_conn(&app, |c| {
        tags::complete_with_aliases(c, &prefix).map_err(|e| e.to_string())
    })
}
