//! 结构化条件与表达式共用的 SQL 谓词真源(标签 / 关键词)。
//! 只产出「固定谓词模板 + `?` 占位符」并把值按占位符次序推进 `args` —— 用户输入
//! 永不进入 SQL 文本(注入面为零)。`n` = notes 行别名,`t` = 标签行别名;
//! 每个谓词自带 EXISTS 子查询,彼此不共用别名实例。
//! 日期比较已整体取消(spec 2026-09-17 D2):谓词真源里不再有日期项。
use rusqlite::types::Value;

/// 标签路径谓词:`self_only` 为真只比本级(`t.path = ?`),否则「本级或 `path/` 前缀」
/// (`substr(path, 1, length(?) + 1) = ? || '/'`)。前缀一律 substr,禁 LIKE 通配符
/// (标签名可能含 `%`/`_`)。值只进参数向量,顺序与占位符一一对应。
///
/// 2026-10-05 携带(spec §4 S1、§5 口径表):若存在标签 A 携带 `path`
/// (`tag_links` 里 `(A,'tag',path)` 的行),则 A 及其全部后代也参与命中 ——
/// 即 `t`(笔记挂着的标签)落在某个携带者的子树内。仅本级 / 含子级两种模式都带这条
/// (它说的是「`path` 被谁继承」,与 `self_only` 无关)。命中集 =
/// 直接挂该标签 ∪ 携带它的标签子树,排除侧走同一份谓词(无黑洞)。
pub(crate) fn tag_predicate(path: &str, self_only: bool, args: &mut Vec<Value>) -> String {
    args.push(Value::Text(path.to_string()));
    let direct = if self_only {
        "t.path = ?".to_string()
    } else {
        args.push(Value::Text(path.to_string()));
        args.push(Value::Text(path.to_string()));
        "t.path = ? OR substr(t.path, 1, length(?) + 1) = ? || '/'".to_string()
    };
    format!("({direct}) OR {}", carry_predicate(path, args))
}

/// 「`t` 落在某个携带 `path` 的标签子树内」:先把「携带者子树的标签 id」物化成一个
/// 集合,再用 `t.id IN (...)` 做成员判定。集合子查询**不引用 `t`/`n`**,SQLite 只求值
/// 一次(QUERY PLAN 里是 `LIST SUBQUERY`);旧写法对每对 (笔记, 标签) 重跑一次相关
/// `EXISTS`(`CORRELATED SCALAR SUBQUERY`),携带行越多、题面越大时越贵,物化集合则与
/// 携带行数近乎无关(复测读数见提交信息)。**适用条件**:优势只在整表扫描/长翻页时体现;
/// 若查询很快被 `LIMIT` 早停填满(如按时间取一页 50 条),旧写法的 OR 短路反而更省 ——
/// 此时物化集合要先付一次全表构建。语义逐值等价:仍是「`d` 与某个携带 `path` 的
/// `ca` 同路径或在其子树内」,前缀用 substr、边界靠显式 `/`;`target_type='tag'`
/// 既限定携带行、又避免把笔记链接(target_id 撞号)误当携带。
///
/// 关系条件(原「类型条件」,设计 2026-10-06 §2 / §10 R10b)直接复用本谓词:迁移 022 把
/// `'type'` 边并入 `'tag'` 后,「R 被哪些标签指向」与「谁携带 R」本就是同一件事。
pub(crate) fn carry_predicate(path: &str, args: &mut Vec<Value>) -> String {
    args.push(Value::Text(path.to_string())); // 定位被携带/被指向标签(按 path 取 id)
    "t.id IN (SELECT d.id FROM tags d \
     JOIN tag_links cl ON cl.target_type = 'tag' \
     JOIN tags ca ON ca.id = cl.tag_id \
     WHERE cl.target_id IN (SELECT id FROM tags WHERE path = ?) \
       AND (d.path = ca.path OR substr(d.path, 1, length(ca.path) + 1) = ca.path || '/'))"
        .to_string()
}

/// `笔记 n 挂有满足 m 的标签` 的 EXISTS 包装;取反(排除标签、`NOT`)由调用方加 `NOT `
pub(crate) fn tag_exists(m: &str) -> String {
    format!(
        "EXISTS (SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id \
         WHERE l.target_type = 'note' AND l.target_id = n.id AND ({m}))"
    )
}

/// 关键词谓词:≥3 字符走 FTS(整串加引号 + 前缀星号,内部引号翻倍转义),否则退化
/// 正文/标签子串 LIKE。时间标签已是普通标签(D3),FTS 与 LIKE 两侧都一视同仁地
/// 参与关键词匹配,不再有"排除时间子树"的例外。
/// LIKE 通配符只出现在这条既有分支,标签路径匹配永不用。
/// <3 字退化同时比 `t.path` 与 `t.name`(spec §4.1):trigram 对 2 字命中不到,而名字是
/// 单段名、路径是完整路径;阶段 3 这里仍指活表 `tags`(T4.3 接 `entities_fts` 时二者
/// 换成 `entities.name` / 新表别名)。
pub(crate) fn keyword_predicate(k: &str, args: &mut Vec<Value>) -> String {
    if k.chars().count() >= 3 {
        args.push(Value::Text(format!("\"{}\"*", k.replace('"', "\"\""))));
        "n.id IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?)".to_string()
    } else {
        let pat = format!("%{k}%");
        args.push(Value::Text(pat.clone()));
        args.push(Value::Text(pat.clone()));
        args.push(Value::Text(pat));
        "(n.content LIKE ? OR EXISTS (SELECT 1 FROM tag_links l JOIN tags t ON t.id = l.tag_id \
         WHERE l.target_type = 'note' AND l.target_id = n.id AND (t.path LIKE ? OR t.name LIKE ?)))"
            .to_string()
    }
}
