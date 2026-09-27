//! 连接级 SQL 标量函数注册(2026-09-26 tag-label-md T5)。
//!
//! 目前只有一个 `tag_plain(路径)` —— 标签路径去掉行内 md 之后的**纯文本形态**,
//! 直接复用 [`crate::tag_label::label_plain`](唯一真源,不在这里写第二份解析),
//! 供 `notes_fts.tags` 的聚合表达式把**祖先段的显示文本**也索引进去:
//! 笔记链的是叶子 `地点/…/[郴](chēn)州市/宜章县`,用户搜 `郴州市` 必须命中。
//!
//! 注册点(缺一处都会出现 `no such function: tag_plain`):
//!   ① 生产连接:`db::open_with` 打开后立即注册;
//!   ② 迁移执行:`db::migrate::run` / `apply` —— 迁移 018 的回填与其中的触发器就要用它,
//!      且测试夹具习惯自己拼连接(内存库 + 迁移),在那里注册才能一处覆盖全部用例。
//! 重复注册由 SQLite 的替换语义吸收(同名同元数即替换,返回 OK),故幂等。
use rusqlite::functions::FunctionFlags;
use rusqlite::Connection;

/// 函数名(聚合表达式与守卫/夹具共用这一处字面量)
pub const TAG_PLAIN_FN: &str = "tag_plain";

/// 在连接上注册本项目用到的 SQL 标量函数(幂等)
pub fn register(conn: &Connection) -> rusqlite::Result<()> {
    conn.create_scalar_function(
        TAG_PLAIN_FN,
        1,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| {
            let raw: String = ctx.get(0)?;
            Ok(crate::tag_label::label_plain(&raw))
        },
    )
}

#[cfg(test)]
#[path = "sql_functions_tests.rs"]
mod sql_functions_tests;
