//! AST -> 中文预览(spec 3.5 的实时预览行):只描述语义,不做转义、截断或加亮。
//! 括号规则:表达式的默认优先级是 `NOT` > `AND` > `OR`,所以只有当子表达式的连接词
//! 比父级优先级更低时才必须补全角括号,否则预览会被读成另一个表达式
//! (brief 要求「左操作数为 Or 时补括号」;右操作数与 `非` 的子项同理补齐,见下方注释)。
use super::ast::{DateOp, Expr};

/// 中文描述入口
pub fn describe(e: &Expr) -> String {
    match e {
        Expr::Tag { path, self_only } => {
            let scope = if *self_only { "仅本级" } else { "含子级" };
            format!("标签({scope}){path}")
        }
        Expr::Keyword(k) => format!("关键词「{k}」"),
        Expr::Date { op, date } => format!("日期{} {date}", date_word(op)),
        Expr::Not(inner) => match &**inner {
            Expr::And(..) | Expr::Or(..) => format!("非 （{}）", describe(inner)),
            _ => format!("非 {}", describe(inner)),
        },
        Expr::And(a, b) => {
            let right = and_side(b);
            match &**a {
                // 左操作数是 Or:全角括号紧贴「且」(brief 的逐字断言)
                Expr::Or(..) => format!("（{}）且 {right}", describe(a)),
                _ => format!("{} 且 {right}", describe(a)),
            }
        }
        // Or 左结合且同级结合律成立,子项不再补括号
        Expr::Or(a, b) => format!("{} 或 {}", describe(a), describe(b)),
    }
}

/// `且` 的一侧:Or 补括号 —— `a 且 （b 或 c）`,否则会被读成 `(a 且 b) 或 c`
fn and_side(e: &Expr) -> String {
    match e {
        Expr::Or(..) => format!("（{}）", describe(e)),
        _ => describe(e),
    }
}

/// 日期算子的中文说法(Lt/Le/Eq/Ge/Gt)
fn date_word(op: &DateOp) -> &'static str {
    match op {
        DateOp::Lt => "早于",
        DateOp::Le => "不晚于",
        DateOp::Eq => "等于",
        DateOp::Ge => "不早于",
        DateOp::Gt => "晚于",
    }
}
