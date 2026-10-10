//! 表达式逃生舱的纯逻辑层(spec 3.1-3.3):词法 -> 语法 -> AST -> 校验 -> 中文预览 -> SQL 片段。
//! 不触数据库、不碰前端;所有错误位置 `pos` 均为**字符下标**(Unicode 字符数,非字节数),
//! 0 起 —— 与前端 `setSelectionRange(position)` 同一口径,结构化字段(ExprError.pos /
//! ExprCheck.position)**绝不改写**。只有拼给用户看的完整文案才由后端格式化(串内 +1 说
//! 「第 N 个字符」、位置到末尾说「表达式末尾」),口径与前端 expr-check.ts 的 errorLabelOf
//! 一致(见 db::repos::notes_filter::expr_error_message 与 2026-09-21 回看 I3)。
//! 校验/编译同时以模块与同名函数两种路径暴露:`crate::expr::validate::validate` 与
//! `crate::expr::validate`(模块在类型命名空间、函数在值命名空间,不冲突),调用点按
//! 计划文档的写法取后者。

pub mod ast;
pub mod compile;
// describe 的接线在 Task 5 完成(commands::expr::validate_expr 的实时预览),已有生产调用;
// 本模块其余部分(validate/compile 被 db::repos::notes_filter 引用,lex 供 validate 使用,
// parse 供 validate 使用)均有生产调用,不做整模块 allow。
pub mod describe;
pub mod lexer;
pub mod parser;
pub mod validate;

pub use compile::compile;
pub use describe::describe;
pub use validate::validate;

/// 筛选条件里的表达式片段(结构化条件 `Expr` 项的唯一入口):表达式含**标签叶子**时
/// 收窄到树外实体(笔记),与结构化 Tag / Relation 条件同口径 —— 收在整段外面而不是
/// 每个叶子上,是因为 `NOT` 必须整体取反(审计 2026-10-09 §1:`A --(remark)--> B`
/// 是关系,不是「A 自己挂了 B」);纯关键词表达式不加收窄,与结构化 Keyword 条件一致。
pub fn compile_for_filter(e: &ast::Expr, args: &mut Vec<rusqlite::types::Value>) -> String {
    let sql = compile(e, args);
    if compile::contains_tag(e) {
        crate::db::repos::notes::notes_filter::note_only(sql)
    } else {
        sql
    }
}

#[cfg(test)]
#[path = "compile_tests.rs"]
mod compile_tests;

#[cfg(test)]
#[path = "describe_tests.rs"]
mod describe_tests;

#[cfg(test)]
#[path = "lexer_tests.rs"]
mod lexer_tests;

// 共享测试向量(仓库根 fixtures/expr-tag-spans.json)的 Rust 侧断言:
// 与前端 src/main-window/filter/expr-tag-spans.test.ts 读同一份文件,钉住展示级镜像
#[cfg(test)]
#[path = "lexer_fixtures_tests.rs"]
mod lexer_fixtures_tests;

#[cfg(test)]
#[path = "parser_tests.rs"]
mod parser_tests;

#[cfg(test)]
#[path = "validate_tests.rs"]
mod validate_tests;

/// 表达式原文长度上限(字符数)
pub const MAX_LEN: usize = 500;
/// token 数上限
pub const MAX_TOKENS: usize = 100;
/// 词法错误文案(界面直接展示;引号短语未闭合)
pub const QUOTE_UNCLOSED: &str = "引号没有闭合";
/// 校验错误文案:引号内没有内容(`""` / `"   "`)
pub const QUOTE_EMPTY: &str = "引号内不能为空";
/// 词法错误文案:日期比较已整体取消(D2),给出明确的迁移指引
pub const DATE_REMOVED: &str = "日期比较已取消,请用时间标签筛选";
/// 词法错误文案:标签路径非法(合法性由 tags::parse_tag_path 判定,此处只补原因文案,
/// 字符集与内嵌标点规则的真源是 tags.rs)
pub const TAG_PATH_INVALID: &str =
    "标签路径不合法(名称可用中文/字母/数字/下划线/连字符,`.`/`·` 需夹在名称之间,用 / 分层)";

/// 括号嵌套层数上限
pub const MAX_DEPTH: usize = 10;
