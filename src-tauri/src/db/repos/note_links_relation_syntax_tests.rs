//! 设计 §6.2「源码写法 -> 期望的线与名字点变化」映射表 **19 行逐行**用例(2026-10-15 T3):
//! 函数名里的数字就是映射表的行号;每条都走**真实保存漏斗**(`update` -> `parse_saved` ->
//! 目标/名字点解析 -> `replace_lines`),只断言表里的两列:线的状态与名字点变化。夹具见 [`support`]。
use rusqlite::params;

#[path = "note_links_relation_syntax_support.rs"]
mod support;
use support::*;

/// 第 1 行:无线 + `#目标` -> 建无名字线(`name_id = NULL`)
#[test]
fn map_row_1_absent_line_creates_plain_line() {
    let mut c = db();
    assert_eq!(after(&mut c, "正文 #地点/日本"), vec![(JAPAN, None)]);
}

/// 第 2 行:无线 + `#目标(国籍)` -> 建名线,并新建名字点
#[test]
fn map_row_2_creates_named_line() {
    let mut c = db();
    let nid = after_named(&mut c, "正文 #地点/日本(国籍)", JAPAN);
    assert_eq!(named_ids(&c, "国籍"), vec![nid], "名字点被线引用");
}

/// 第 3 行:无名字线 + `#目标` -> 不动(幂等:线 id 与名字都不动)
#[test]
fn map_row_3_plain_line_is_untouched() {
    let mut c = db();
    let id = line(&c, JAPAN, None);
    save(&mut c, "正文 #地点/日本");
    assert_eq!(rows(&c), vec![(id, JAPAN, None)]);
}

/// 第 4 行:无名字线 + `#目标(国籍)` -> 同一条线换名字(不新开线)
#[test]
fn map_row_4_unnamed_line_takes_name() {
    let mut c = db();
    let id = line(&c, JAPAN, None);
    let nid = after_named(&mut c, "正文 #地点/日本(国籍)", JAPAN);
    assert_eq!(rows(&c), vec![(id, JAPAN, Some(nid))], "线 id 不变");
    assert_eq!(meta_of(&c, nid), "国籍");
}

/// 第 5 行:名线(国籍) + `#目标(国籍)` -> 不动(名字点复用)
#[test]
fn map_row_5_named_line_is_untouched() {
    let mut c = db();
    let nid = name_point(&c, "国籍");
    let id = line(&c, JAPAN, Some(nid));
    save(&mut c, "正文 #地点/日本(国籍)");
    assert_eq!((rows(&c), named_ids(&c, "国籍")), (vec![(id, JAPAN, Some(nid))], vec![nid]));
}

/// 第 6 行:名线(国籍) + `#目标` -> 清名字(`name_id -> NULL`),线保留
#[test]
fn map_row_6_name_cleared_by_bare_target() {
    let mut c = db();
    let id = line(&c, JAPAN, Some(name_point(&c, "国籍")));
    save(&mut c, "正文 #地点/日本");
    assert_eq!(rows(&c), vec![(id, JAPAN, None)]);
    assert!(named_ids(&c, "国籍").is_empty(), "旧名字点随最后引用被 GC");
}

/// 第 7 行:名线(国籍) + `#目标()` -> 同第 6 行(空组 = 无名字)
#[test]
fn map_row_7_empty_group_clears_name() {
    let mut c = db();
    let id = line(&c, JAPAN, Some(name_point(&c, "国籍")));
    save(&mut c, "正文 #地点/日本()");
    assert_eq!(rows(&c), vec![(id, JAPAN, None)]);
    assert!(named_ids(&c, "国籍").is_empty());
}

/// 第 8 行:名线(国籍) + `#目标(所在)` -> 换名字(`UPDATE name_id`)
#[test]
fn map_row_8_rename_keeps_line_id() {
    let mut c = db();
    let id = line(&c, JAPAN, Some(name_point(&c, "国籍")));
    let nid = after_named(&mut c, "正文 #地点/日本(所在)", JAPAN);
    assert_eq!(rows(&c), vec![(id, JAPAN, Some(nid))], "换名字不改线身份");
    assert_eq!(meta_of(&c, nid), "所在");
    assert!(named_ids(&c, "国籍").is_empty(), "旧名字点被 GC");
}

/// 第 9 行:名线(国籍) + 不写 -> 删线 + 名字点 GC
#[test]
fn map_row_9_missing_target_deletes_line_and_name_point() {
    let mut c = db();
    line(&c, JAPAN, Some(name_point(&c, "国籍")));
    assert!(after(&mut c, "正文里没有该目标").is_empty());
    assert!(named_ids(&c, "国籍").is_empty());
}

/// 第 10 行:无名字线 + 不写 -> 删线
#[test]
fn map_row_10_missing_target_deletes_plain_line() {
    let mut c = db();
    line(&c, JAPAN, None);
    assert!(after(&mut c, "正文里没有该目标").is_empty());
}

/// 第 11 行:任一 + `#目标 #目标(国籍)`(两种顺序)-> 名字组胜
#[test]
fn map_row_11_name_group_wins() {
    let mut c = db();
    let nid = after_named(&mut c, "正文 #地点/日本 #地点/日本(国籍)", JAPAN);
    assert_eq!(meta_of(&c, nid), "国籍");
    save(&mut c, "正文 #地点/日本(国籍) #地点/日本");
    assert_eq!(pairs(&c), vec![(JAPAN, Some(nid))], "倒过来的顺序同样收敛到名线");
}

/// 第 12 行:任一 + `#目标(甲) #目标(乙)` -> 首现胜;输掉的名字组不建点
#[test]
fn map_row_12_first_named_group_wins() {
    let mut c = db();
    let nid = after_named(&mut c, "正文 #地点/日本(甲) #地点/日本(乙)", JAPAN);
    assert_eq!(meta_of(&c, nid), "甲");
    assert!(named_ids(&c, "乙").is_empty(), "乙不落地");
}

/// 第 13 行:面板造的多条名线(P9)-> `#目标(甲)` 收敛为一条
#[test]
fn map_row_13_multi_name_lines_collapse() {
    let mut c = db();
    let jia = name_point(&c, "甲");
    let keep = line(&c, JAPAN, Some(jia));
    line(&c, JAPAN, Some(name_point(&c, "乙")));
    save(&mut c, "正文 #地点/日本(甲)");
    assert_eq!(rows(&c), vec![(keep, JAPAN, Some(jia))], "一个目标只留一条线(先建的那条)");
    assert!(named_ids(&c, "乙").is_empty(), "被收敛掉的名字点被 GC");
}

/// 第 14 行:名线(国籍) + `#目标(国籍) [[X]]` -> 并集里该目标仍是名线
#[test]
fn map_row_14_link_union_does_not_downgrade_name() {
    let mut c = db();
    let nid = name_point(&c, "国籍");
    line(&c, JAPAN, Some(nid));
    save(&mut c, "正文 #地点/日本(国籍) [[链接目标]]");
    assert_eq!(pairs(&c), vec![(JAPAN, Some(nid)), (92, None)], "链接只补缺席目标");
}

/// 第 15 行:无线 + `#目标/新路径(国籍)` -> 自动建树 + 名线
#[test]
fn map_row_15_new_path_is_created_with_name() {
    let mut c = db();
    save(&mut c, "正文 #地点/新路径(国籍)");
    let (to, name) = pairs(&c)[0];
    assert_eq!(path_of(&c, to).as_deref(), Some("地点/新路径"), "自动建树");
    assert_eq!(meta_of(&c, name.expect("名线")), "国籍");
}

/// 第 16 行:只有 `[[X]]` -> 无名字线(链接仍只是链接)
#[test]
fn map_row_16_link_only_stays_plain() {
    let mut c = db();
    assert_eq!(after(&mut c, "正文 [[链接目标]]"), vec![(92, None)]);
}

/// 第 17 行:名线(国籍) + `#目标(国籍`(未闭合)-> 同第 9 行删线
#[test]
fn map_row_17_invalid_group_deletes_line() {
    let mut c = db();
    line(&c, JAPAN, Some(name_point(&c, "国籍")));
    assert!(after(&mut c, "正文 #地点/日本(国籍").is_empty(), "组非法:整串不认");
    assert!(named_ids(&c, "国籍").is_empty());
}

/// 第 18 行:名字点已被面板改名为「国籍2」-> 逐字节找不到就**新建**
#[test]
fn map_row_18_renamed_name_point_is_not_reused() {
    let mut c = db();
    let old = name_point(&c, "国籍");
    line(&c, JAPAN, Some(old));
    c.execute("UPDATE points SET meta = '国籍2' WHERE id = ?1", params![old]).unwrap();
    let nid = after_named(&mut c, "正文 #地点/日本(国籍)", JAPAN);
    assert_ne!(nid, old, "不复用 meta 已变的点");
    assert_eq!(meta_of(&c, nid), "国籍");
}

/// 第 19 行:名字点 `meta` 有尾随空格 -> 逐字节不匹配 => 新建
#[test]
fn map_row_19_trailing_space_meta_is_not_reused() {
    let mut c = db();
    let old = line(&c, JAPAN, Some(name_point(&c, "国籍 ")));
    let nid = after_named(&mut c, "正文 #地点/日本(国籍)", JAPAN);
    assert_ne!(nid, old, "尾随空格 = 逐字节不匹配");
    assert_eq!(meta_of(&c, nid), "国籍");
}

// 名字点复用(第 2 行的 `meta` 复用口径):两个目标写同一个名字文本只建**一个**点
#[test]
fn name_point_is_shared_across_targets() {
    let mut c = db();
    save(&mut c, "正文 #地点/日本(国籍) #地点/中国(国籍)");
    let ids = named_ids(&c, "国籍");
    assert_eq!(pairs(&c), vec![(JAPAN, Some(ids[0])), (CHINA, Some(ids[0]))], "两条线共用一个点");
    assert_eq!(ids.len(), 1);
}
