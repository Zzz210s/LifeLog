//! 别名仓库层测试(测试先行):resolve / add / remove / list_for_tag / register_rename。
//! 关键口径:只有登记过的原样字符串才归一(D2);叶子名冲突时以现有标签为准(D4)。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes;
use crate::db::repos::tags_tree::rename;
use rusqlite::Connection;

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn id_at(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", [path], |r| r.get(0))
        .unwrap()
}

/// ① resolve:未登记 -> None;登记后返回目标**当前路径**;目标改名后返回新路径
#[test]
fn resolve_returns_target_current_path_and_follows_rename() {
    let mut c = db();
    notes::create_plain(&mut c, "看番 #追番/日漫").unwrap();
    let id = id_at(&c, "追番/日漫");

    assert_eq!(resolve(&c, "日漫").unwrap(), None, "未登记不得归一");
    assert_eq!(resolve(&c, " 日漫 ").unwrap(), None, "trim 后仍未登记");
    add(&c, "日漫", id).unwrap();
    assert_eq!(resolve(&c, "日漫").unwrap().as_deref(), Some("追番/日漫"));
    assert_eq!(
        resolve(&c, " 日漫 ").unwrap().as_deref(),
        Some("追番/日漫"),
        "入参先 trim(与解析器一致)"
    );

    // 别名存的是"指向"而非路径快照:目标改名后解析出的是新路径
    rename(&mut c, id, "动画").unwrap();
    assert_eq!(resolve(&c, "日漫").unwrap().as_deref(), Some("追番/动画"));
}

/// ② add:空 / 含空白 / 含 `#` / 与现有标签路径同名一律拒绝且不落库
#[test]
fn add_rejects_invalid_and_existing_tag_path() {
    let mut c = db();
    notes::create_plain(&mut c, "a #工作 #工作/项目A").unwrap();
    let id = id_at(&c, "工作/项目A");

    assert!(add(&c, "", id).is_err(), "空别名");
    assert!(add(&c, " 日漫", id).is_err(), "前导空白");
    assert!(add(&c, "日 漫", id).is_err(), "中间空白");
    assert!(add(&c, "#日漫", id).is_err(), "含 #");
    let err = add(&c, "工作", id).unwrap_err();
    assert!(err.to_string().contains("别名与现有标签重名"), "{err}");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_aliases"), 0, "被拒的登记不落库");
}

/// ③ add:同一别名重复登记 = 更新指向(只有一行),list_for_tag 给出该标签的别名
#[test]
fn add_updates_target_on_repeat() {
    let mut c = db();
    notes::create_plain(&mut c, "a #甲 #乙").unwrap();
    let jia = id_at(&c, "甲");
    let yi = id_at(&c, "乙");

    add(&c, "旧名", jia).unwrap();
    add(&c, "旧名", yi).unwrap();

    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_aliases"), 1);
    assert_eq!(resolve(&c, "旧名").unwrap().as_deref(), Some("乙"));
    assert!(list_for_tag(&c, jia).unwrap().is_empty());
    assert_eq!(list_for_tag(&c, yi).unwrap(), vec!["旧名".to_string()]);
}

/// ④ remove:存在则删;不存在不报错(幂等)
#[test]
fn remove_deletes_and_tolerates_missing() {
    let mut c = db();
    notes::create_plain(&mut c, "a #甲").unwrap();
    let id = id_at(&c, "甲");
    add(&c, "旧名", id).unwrap();

    remove(&c, "旧名").unwrap();
    assert_eq!(resolve(&c, "旧名").unwrap(), None);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM tag_aliases"), 0);
    remove(&c, "旧名").unwrap(); // 再删一次不报错
}

/// ⑤ 改名自动登记:返回列表为"完整路径在前、叶子名在后",两条都能解析回目标
#[test]
fn rename_registers_old_path_and_leaf() {
    let mut c = db();
    notes::create_plain(&mut c, "a #追番/日漫").unwrap();
    let id = id_at(&c, "追番/日漫");

    let aliases = rename(&mut c, id, "动画").unwrap();

    assert_eq!(aliases, vec!["追番/日漫".to_string(), "日漫".to_string()]);
    for alias in ["追番/日漫", "日漫"] {
        assert_eq!(resolve(&c, alias).unwrap().as_deref(), Some("追番/动画"), "{alias}");
    }
    // 根标签:叶子名 == 完整路径,只登记一次
    notes::create_plain(&mut c, "b #电影").unwrap();
    let fid = id_at(&c, "电影");
    assert_eq!(rename(&mut c, fid, "影片").unwrap(), vec!["电影".to_string()]);
    assert_eq!(resolve(&c, "电影").unwrap().as_deref(), Some("影片"));
}

/// ⑥ 叶子名冲突时只登记完整路径:与现有标签路径同名 / 已被别的标签占用都不夺走
#[test]
fn rename_skips_leaf_on_conflict() {
    // ① 叶子名是现有标签路径:以真实标签为准
    let mut c = db();
    notes::create_plain(&mut c, "a #追番/日漫").unwrap();
    notes::create_plain(&mut c, "b #日漫").unwrap();
    let id = id_at(&c, "追番/日漫");

    assert_eq!(rename(&mut c, id, "动画").unwrap(), vec!["追番/日漫".to_string()]);
    assert_eq!(resolve(&c, "日漫").unwrap(), None, "真实标签不得被别名劫持");
    assert_eq!(resolve(&c, "追番/日漫").unwrap().as_deref(), Some("追番/动画"));

    // ② 叶子名已指向别的标签:跳过,不把别人的别名抢过来
    let mut c2 = db();
    notes::create_plain(&mut c2, "a #追番/日漫").unwrap();
    notes::create_plain(&mut c2, "b #甲").unwrap();
    let other = id_at(&c2, "甲");
    let id2 = id_at(&c2, "追番/日漫");
    add(&c2, "日漫", other).unwrap();

    assert_eq!(rename(&mut c2, id2, "动画").unwrap(), vec!["追番/日漫".to_string()]);
    assert_eq!(resolve(&c2, "日漫").unwrap().as_deref(), Some("甲"));
}

/// ⑦ 目标标签存在性(命令层 add_tag_alias 的中文错前置校验)
#[test]
fn tag_exists_reports_missing_target() {
    let mut c = db();
    notes::create_plain(&mut c, "a #甲").unwrap();
    let id = id_at(&c, "甲");
    assert!(tag_exists(&c, id).unwrap());
    assert!(!tag_exists(&c, id + 999).unwrap());
}
