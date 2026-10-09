//! `keyword_predicate` 的 <3 字退化分支:2 字标签名必须能命中(spec §4.1 / §8.3)。
//! trigram 对 <3 字命中不到,搜索侧靠 LIKE 的 `t.path` 与 `t.meta` 兜底;这里构造
//! 「名字(meta)不在路径里」的实体,把 meta 分支单独钉住 —— 去掉 `t.meta LIKE ?` 本用例必红。
use super::{where_clause, FilterConditions};
use rusqlite::{params_from_iter, Connection};

/// 028 起无 `kind`/`name`/`content`:实体直接写 `entities(meta)`,引用落 `edges(kind='link')`。
fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    crate::db::migrate::run(&c).unwrap();
    c.execute_batch(
        "INSERT INTO entities(id,meta,created_at,path,depth) VALUES
           (1,'莽山栈道','2026-01-01',NULL,NULL),
           (2,'湖南','2026-01-01','区划',1);
         INSERT INTO edges(source_id,target_id,kind,created_at) VALUES (1,2,'link','2026-01-01');",
    )
    .unwrap();
    c
}

fn hits(c: &Connection, k: &str) -> Vec<i64> {
    let conds = FilterConditions { keyword: Some(k.into()), ..Default::default() };
    let (frag, args) = where_clause(&conds).unwrap();
    let mut stmt = c
        .prepare(&format!(
            "SELECT n.id FROM entities n WHERE ({frag}) AND n.path IS NULL ORDER BY n.id",
        ))
        .unwrap();
    let rows = stmt.query_map(params_from_iter(args), |r| r.get(0)).unwrap();
    rows.map(|r| r.unwrap()).collect()
}

/// 2 字实体名经 meta 分支命中。把标签路径改成不含名字的两个字(真实库里名字恒是路径叶子,
/// 这里刻意造不一致),路径 LIKE 必然落空,只有 `t.meta LIKE` 能捞到 —— 该分支的独立证据。
#[test]
fn two_char_tag_name_matches_via_meta_like() {
    let c = db();
    assert_eq!(hits(&c, "湖南"), vec![1], "2 字实体名必须经 t.meta LIKE 命中");
    assert!(hits(&c, "湖北").is_empty(), "不误伤其它 2 字关键词");
}
