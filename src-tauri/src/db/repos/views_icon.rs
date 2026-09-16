//! 视图图标名校验(spec 4:图标名是稳定键,落库前只做长度与字符集校验)。
//! 本文件从 views.rs 拆出以守 200 行上限;渲染白名单在前端 `view-icons.tsx`,
//! 后端不持有图标清单:白名单外的名字照常入库,只是不渲染。
/// 图标名长度上限(字符数;白名单名字都是 ASCII)
const MAX_ICON_CHARS: usize = 40;

/// 图标名校验:长度 ≤40 且只含 `[a-z0-9-]`;None / 空串 / 全空白都等价于「无图标」。
/// 错误文案:`图标名过长`(超长)/`图标名不合法`(字符集)。
pub fn validate_icon(icon: Option<&str>) -> Result<(), String> {
    let s = icon.unwrap_or("").trim();
    if s.chars().count() > MAX_ICON_CHARS {
        return Err("图标名过长".into());
    }
    if !s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') {
        return Err("图标名不合法".into());
    }
    Ok(())
}

/// 入库用的图标名:校验后把空串/全空白归一为 NULL(空串等价于无图标,不写空串)
pub fn icon_of(icon: Option<&str>) -> Result<Option<String>, String> {
    validate_icon(icon)?;
    let s = icon.unwrap_or("").trim();
    Ok(if s.is_empty() { None } else { Some(s.to_string()) })
}
