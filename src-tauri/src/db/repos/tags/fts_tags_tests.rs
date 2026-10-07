//! T4/T5 守卫与行为读数:`notes_fts.tags` 列 = 路径聚合 + 纯文本路径聚合 + 别名聚合。
//! ① 迁移 018 里的表达式副本必须与共享常量逐字一致(否则"两边都写了一份"迟早分叉);
//! ② md 改名后,用**显示文本**与**旧名**都能搜到同一篇笔记;
//! ③ 普通标签的索引串不受影响(无 md、无别名即纯路径,且无尾随空格 —— 与 T4 逐字节一致);
//! ④ 别名的登记/改指向/删除都要立刻反映到索引(改指向靠 upsert 走 UPDATE 触发器);
//! ⑤ 迁移 018 可重放(幂等:重放后索引串、版本号、触发器集合都不变)。
//! T5 的核心场景(祖先段带 md + 笔记链叶子)见 `fts_tag_plain_tests`。
use crate::db::migrate;
use crate::db::repos::notes::{create_plain, notes_filter::empty, query, FilterConditions};
use crate::db::repos::tags::fts_tags::{MIGRATION_018_SQL, TAGS_AGG};
use crate::db::repos::tags::invariants_tests::assert_fts_matches_tags;
use crate::db::repos::tags::{alias, rename};
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    crate::db::repos::tags::test_support::install_entity_views(&c);
    c
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", [path], |r| r.get(0)).unwrap()
}

/// 该笔记在 FTS 里的 tags 列
fn fts_tags(c: &Connection, id: i64) -> String {
    c.query_row("SELECT tags FROM notes_fts WHERE rowid=?1", params![id], |r| r.get(0))
        .unwrap()
}

/// 关键词命中的笔记 id(≥3 字符走 FTS;单字走 LIKE 分支,两条路都要覆盖)
fn hits(c: &Connection, keyword: &str) -> Vec<i64> {
    let conds = FilterConditions { keyword: Some(keyword.into()), ..empty() };
    query(c, &conds, 0).unwrap().into_iter().map(|n| n.id).collect()
}

/// 空白归一(比对 .sql 副本与 Rust 常量时忽略缩进/换行差异)
fn squash(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// ① 守卫:018 里每条写 FTS 的语句都必须用共享表达式,一条都不许分批口径
#[test]
fn migration_018_uses_the_shared_expression() {
    let sql = squash(MIGRATION_018_SQL);
    let expr = squash(TAGS_AGG);
    let writes = sql.matches("INSERT INTO notes_fts(rowid, content, tags)").count();
    assert_eq!(writes, 7, "018 = 六个触发器 + 一次回填");
    assert_eq!(sql.matches(&expr).count(), writes, "有语句没走共享表达式(旧口径残留)");
}

/// ② md 改名:显示文本与旧名都可搜;单字 LIKE 分支不受影响
#[test]
fn md_rename_is_searchable_by_display_text_and_old_name() {
    let mut c = db();
    let n = create_plain(&mut c, "甲 #郴chen州市").unwrap();
    // 前置:改名前的显示文本确实搜不到(这就是 T4 要修的问题)
    assert!(hits(&c, "郴州市").is_empty(), "前置条件不成立,用例失去意义");

    let old = id_at(&c, "郴chen州市");
    rename(&mut c, old, "[郴](chēn)州市").unwrap();

    assert_eq!(hits(&c, "郴州市"), vec![n.id], "显示文本(纯文本别名)必须命中");
    assert_eq!(hits(&c, "郴chen州市"), vec![n.id], "旧名(旧路径别名)也必须命中");
    assert_eq!(hits(&c, "郴"), vec![n.id], "单字走 LIKE 分支,行为不变");
    assert_fts_matches_tags(&c);
}

/// ③ 普通标签:无 md、无别名时索引串就是路径本身(trim 后无尾随空格),检索照旧
#[test]
fn plain_tags_keep_a_path_only_index() {
    let mut c = db();
    let n = create_plain(&mut c, "买牛奶 #生活").unwrap();
    assert_eq!(fts_tags(&c, n.id), "生活", "无别名时不该多出空格或杂质(与 T4 逐字节一致)");
    assert_eq!(hits(&c, "买牛奶"), vec![n.id]);
    assert_eq!(hits(&c, "生活"), vec![n.id]);
}

/// ④ 别名生命周期:登记 -> 改指向 -> 删除,索引每一步都跟着走
#[test]
fn alias_insert_repoint_and_delete_reach_the_index() {
    let mut c = db();
    let a = create_plain(&mut c, "甲 #甲").unwrap();
    let b = create_plain(&mut c, "乙 #乙").unwrap();
    let (jia, yi) = (id_at(&c, "甲"), id_at(&c, "乙"));

    assert!(hits(&c, "柴米油盐").is_empty(), "前置:未登记不得命中");
    alias::add(&c, "柴米油盐", jia).unwrap();
    assert_eq!(hits(&c, "柴米油盐"), vec![a.id], "新登记别名必须立刻可搜(INSERT 触发器)");
    alias::add(&c, "柴米油盐", yi).unwrap();
    assert_eq!(hits(&c, "柴米油盐"), vec![b.id], "改指向后旧目标不得残留(UPDATE 触发器)");
    alias::remove(&c, "柴米油盐").unwrap();
    assert!(hits(&c, "柴米油盐").is_empty(), "删除别名后索引不得残留(DELETE 触发器)");
    assert_fts_matches_tags(&c);
}

/// 迁移重放读数:索引串 / 版本号 / 别名触发器集合 / 别名行数(整体快照)
fn snapshot(c: &Connection) -> String {
    let fts: String =
        c.query_row("SELECT tags FROM notes_fts WHERE rowid=1", [], |r| r.get(0)).unwrap();
    let version: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    let triggers: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master
              WHERE type='trigger' AND name LIKE 'tag_aliases_%'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let aliases: i64 = c.query_row("SELECT COUNT(*) FROM tag_aliases", [], |r| r.get(0)).unwrap();
    format!("{fts}|v{version}|{triggers}|{aliases}")
}

/// ⑤ 直接重放 018 的 SQL(绕开版本闸门)必须是空操作
#[test]
fn migration_018_replay_is_a_noop() {
    let mut c = db();
    create_plain(&mut c, "甲 #地点/郴chen州市/宜章县").unwrap();
    let old = id_at(&c, "地点/郴chen州市");
    rename(&mut c, old, "[郴](chēn)州市").unwrap();

    // 018 的 SQL 要在老表上建触发器(视图上不能建),夹具把视图物化成同名真表;
    // 先重放一次恢复被替换掉的触发器,再验“再重放是空操作”。
    crate::db::repos::tags::test_support::materialize_legacy(&c);
    c.execute_batch(MIGRATION_018_SQL).unwrap();
    let once = snapshot(&c);
    assert!(once.contains("郴州市"), "回填后索引串里必须有纯文本路径或别名:{once}");

    c.execute_batch(MIGRATION_018_SQL).unwrap();
    assert_eq!(snapshot(&c), once, "重放 018 必须不改库");
    migrate::run(&c).unwrap();
    assert_eq!(snapshot(&c), once, "版本闸门已到 18,再跑迁移也是空操作");
}
