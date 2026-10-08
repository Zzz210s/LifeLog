//! 连接级 SQL 标量函数注册(2026-09-26 tag-label-md T5)。
//!
//! `tag_plain(路径)` —— 标签路径去掉行内 md 之后的**纯文本形态**,
//! 直接复用 [`crate::tag_label::label_plain`](唯一真源,不在这里写第二份解析),
//! 供 `entities_fts.tag_paths` 的聚合表达式把**祖先段的显示文本**也索引进去:
//! 笔记链的是叶子 `地点/…/[郴](chēn)州市/宜章县`,用户搜 `郴州市` 必须命中。
//!
//! 统一元数据(spec §2.6)再加两个,同样只做**转发**、不另写解析:
//!   * `entity_name(meta)` = 第一条非空行裁首尾空白(大小写原样) -> [`crate::links::display_title`];
//!   * `entity_key(meta)`  = `entity_name` 再走 `normalize_title`(剥行内 `#` 词元 + 折叠空白 +
//!     ASCII 小写) -> [`crate::links::title_of`]。
//!
//! 两者与前端镜像 `src/shared/note-link-syntax.ts` 的 `displayTitle` / `titleOf` 同读
//! `fixtures/entity-meta.json`(前端 `entity-meta.test.ts`、Rust `unify_meta_hook_tests.rs`)。
//!
//! 注册点(缺一处都会出现 `no such function`):
//!   ① 生产连接:`db::open_with` 打开后立即注册;
//!   ② 迁移执行:`db::migrate::run` / `apply` —— 迁移 018 的回填与其中的触发器就要用 `tag_plain`,
//!      028 起 SQL / 索引还会用 `entity_name` / `entity_key`,且测试夹具习惯自己拼连接(内存库 +
//!      迁移),在那里注册才能一处覆盖全部用例。
//! 重复注册由 SQLite 的替换语义吸收(同名同元数即替换,返回 OK),故幂等。
use rusqlite::functions::FunctionFlags;
use rusqlite::Connection;

/// 函数名(聚合表达式与守卫/夹具共用这一处字面量)
pub const TAG_PLAIN_FN: &str = "tag_plain";
/// 统一元数据的**名字**口径:第一条非空行裁首尾空白(大小写原样)
pub const ENTITY_NAME_FN: &str = "entity_name";
/// 统一元数据的**合并键**:名字再走 `normalize_title`(剥 `#` 词元、折叠空白、ASCII 小写)
pub const ENTITY_KEY_FN: &str = "entity_key";

/// 在连接上注册本项目用到的 SQL 标量函数(幂等)。
/// 三者都标 `SQLITE_DETERMINISTIC`:它们会出现在索引 / 触发器表达式里,不标会被 SQLite 拒绝。
pub fn register(conn: &Connection) -> rusqlite::Result<()> {
    let flags = || FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC;
    conn.create_scalar_function(TAG_PLAIN_FN, 1, flags(), |ctx| {
        let raw: String = ctx.get(0)?;
        Ok(crate::tag_label::label_plain(&raw))
    })?;
    conn.create_scalar_function(ENTITY_NAME_FN, 1, flags(), |ctx| {
        let raw: String = ctx.get(0)?;
        Ok(crate::links::display_title(&raw))
    })?;
    conn.create_scalar_function(ENTITY_KEY_FN, 1, flags(), |ctx| {
        let raw: String = ctx.get(0)?;
        Ok(crate::links::title_of(&raw))
    })
}

#[cfg(test)]
#[path = "sql_functions_tests.rs"]
mod sql_functions_tests;
