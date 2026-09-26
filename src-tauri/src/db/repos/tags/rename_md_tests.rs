//! T2 库级证据:界面把标签名改成行内 md(`[郴](chēn)州市`)之后 ——
//! ① 改名成功(旧的正文校验会拒);② 纯文本形态自动登记为别名,正文 `#郴州市` 命中同一标签;
//! ③ 纯文本被真实标签 / 别人的别名占住时**跳过**(不改名的成败);④ FTS 不变量仍成立。
use crate::db::migrate;
use crate::db::repos::notes;
use crate::db::repos::tags::invariants_tests::assert_fts_matches_tags;
use crate::db::repos::tags::{alias, link_paths, rename};
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", [path], |r| r.get(0)).unwrap()
}

/// 该标签是否链着这条笔记
fn links(c: &Connection, tag_id: i64, note_id: i64) -> i64 {
    c.query_row(
        "SELECT COUNT(*) FROM tag_links WHERE tag_id=?1 AND target_type='note' AND target_id=?2",
        params![tag_id, note_id],
        |r| r.get(0),
    )
    .unwrap()
}

/// ① 根级:md 改名成功;纯文本 `郴州市` 成为别名,正文 `#郴州市` 归到同一个标签
#[test]
fn rename_to_md_name_bridges_plain_alias() {
    let mut c = db();
    let n = notes::create_plain(&mut c, "a #郴chen州市").unwrap();
    let id = id_at(&c, "郴chen州市");

    let aliases = rename(&mut c, id, "[郴](chēn)州市").unwrap();

    assert_eq!(aliases, vec!["郴chen州市".to_string(), "郴州市".to_string()]);
    assert_eq!(id_at(&c, "[郴](chēn)州市"), id, "名字与路径都换成 md 形态");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='郴州市'"), 0, "别名不是节点");

    // 正文里写纯文本,照样命中同一个标签(别名桥接的唯一目的)
    let n2 = notes::create_plain(&mut c, "b #郴州市").unwrap();
    assert_eq!(links(&c, id, n2.id), 1, "#郴州市 应命中 md 标签");
    // 旧名仍能解析(D4 既有行为)
    link_paths(&c, n.id, &["郴chen州市".to_string()]).unwrap();
    assert_eq!(links(&c, id, n.id), 1, "旧名仍解析到同一标签");
    assert_fts_matches_tags(&c);
}

/// ② 有父级:纯文本的**整条路径**与**叶子名**都登记,两种写法都能命中
#[test]
fn nested_md_rename_registers_path_and_leaf_plain() {
    let mut c = db();
    notes::create_plain(&mut c, "a #地点/郴chen州市").unwrap();
    let id = id_at(&c, "地点/郴chen州市");

    let aliases = rename(&mut c, id, "[郴](chēn)州市").unwrap();

    assert_eq!(
        aliases,
        vec![
            "地点/郴chen州市".to_string(),
            "郴chen州市".to_string(),
            "地点/郴州市".to_string(),
            "郴州市".to_string()
        ]
    );
    for path in ["地点/郴州市", "郴州市", "地点/郴chen州市", "郴chen州市"] {
        let n = notes::create_plain(&mut c, &format!("x #{path}")).unwrap();
        assert_eq!(links(&c, id, n.id), 1, "#{path} 应命中 md 标签");
    }
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='地点/[郴](chēn)州市'"), 1);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE path='郴州市'"), 0, "别名不建根节点");
    assert_fts_matches_tags(&c);
}

/// ③ 纯文本已被**真实标签**占用:跳过(不夺走),改名本身照样成功
#[test]
fn plain_alias_is_skipped_when_a_real_tag_owns_the_name() {
    let mut c = db();
    notes::create_plain(&mut c, "a #郴州市").unwrap();
    notes::create_plain(&mut c, "b #郴chen州市").unwrap();
    let real = id_at(&c, "郴州市");
    let id = id_at(&c, "郴chen州市");

    let aliases = rename(&mut c, id, "[郴](chēn)州市").unwrap();

    assert_eq!(aliases, vec!["郴chen州市".to_string()], "纯文本被真实标签占住 -> 跳过");
    assert_eq!(alias::resolve(&c, "郴州市").unwrap(), None, "真实标签不得被别名劫持");
    let n = notes::create_plain(&mut c, "c #郴州市").unwrap();
    assert_eq!(links(&c, real, n.id), 1, "正文仍归真实标签");
    assert_eq!(links(&c, id, n.id), 0);
    assert_fts_matches_tags(&c);
}

/// ④ 纯文本已指向**别的标签的别名**:同样跳过,不抢别人的
#[test]
fn plain_alias_is_skipped_when_another_alias_owns_it() {
    let mut c = db();
    notes::create_plain(&mut c, "a #甲").unwrap();
    notes::create_plain(&mut c, "b #郴chen州市").unwrap();
    let other = id_at(&c, "甲");
    alias::add(&c, "郴州市", other).unwrap();
    let id = id_at(&c, "郴chen州市");

    let aliases = rename(&mut c, id, "[郴](chēn)州市").unwrap();

    assert_eq!(aliases, vec!["郴chen州市".to_string()]);
    assert_eq!(alias::resolve(&c, "郴州市").unwrap().as_deref(), Some("甲"));
    assert_fts_matches_tags(&c);
}

/// ⑤ 改名边界:空 / 含 `/` / 控制字符 / 超长被拒且不动库;普通单段名与非链接 md 名放行
#[test]
fn rename_rejects_unusable_names_and_keeps_plain_ones() {
    let mut c = db();
    notes::create_plain(&mut c, "a #工作").unwrap();
    let id = id_at(&c, "工作");

    for bad in ["", "a/b", "a\tb", "a\u{7}b"] {
        assert!(rename(&mut c, id, bad).is_err(), "应拒:{bad:?}");
    }
    assert!(rename(&mut c, id, &"长".repeat(crate::tags::MAX_LABEL_CHARS + 1)).is_err(), "超长");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tags WHERE name='工作'"), 1, "被拒的改名不动库");

    rename(&mut c, id, "项目A").unwrap();
    assert_eq!(id_at(&c, "项目A"), id, "普通单段名照旧");
    rename(&mut c, id, "**重点**").unwrap();
    assert_eq!(id_at(&c, "**重点**"), id, "非链接的 md 名也放行");
    assert_eq!(alias::resolve(&c, "重点").unwrap().as_deref(), Some("**重点**"));
    assert_fts_matches_tags(&c);
}
