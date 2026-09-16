//! 表达式实时校验命令(spec 3.3):解析、语义校验与中文预览的真源是 [`crate::expr`],
//! 这里只把结果转成前端可用的形状,不重复任何解析逻辑(前端更没有第二套解析器)。
use serde::Serialize;

use crate::expr;

/// 实时校验结果:`ok=false` 时 `message`/`position` 有意义,`preview` 为空串。
/// `position` 是**字符下标(0 起,Unicode 字符数)**,与 `setSelectionRange` 同一口径;
/// 显示成「第 N 个字符」时由界面自行 +1,后端绝不预先加 1。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExprCheck {
    pub ok: bool,
    pub message: String,
    pub position: usize,
    pub preview: String,
}

/// 校验表达式:合法给出中文预览;非法给出中文原因与出错字符位置。
/// 空串/全空白也算非法(「表达式为空」)—— 界面侧把全空白视作"没有表达式",不会调到这条。
#[tauri::command]
pub fn validate_expr(text: String) -> ExprCheck {
    match expr::validate(&text) {
        Ok(ast) => ExprCheck {
            ok: true,
            message: String::new(),
            position: 0,
            preview: expr::describe(&ast),
        },
        Err(e) => ExprCheck {
            ok: false,
            message: e.message,
            position: e.pos,
            preview: String::new(),
        },
    }
}

#[cfg(test)]
#[path = "expr_tests.rs"]
mod expr_tests;
