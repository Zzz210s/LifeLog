//! 任务 A 回归(2026-10-12):来源的**有名线(关系)**与无名字线同属「这个来源的关系集合」。
//! 编辑框回显的就是 read_full 读到的全部非子级线目标路径,名线也在内 —— 所以把某个 `#路径`
//! 删掉就等于「这条关系不要了」,不许留一条读得回来、却删不掉的名线。
//! 真库实例:`地点/印度`(点 1941)卡片上有两个同名 chip,编辑框里删多少次都删不掉。
//! T3 起编辑框回显的名线带名字组(`#状态/未完成(状态)`,前端 composeSource 的形态),保存按
//! 名字组落地 —— **裸 `#目标` 的语义是「清名字」**(设计 §6.2 第 6 行),故「名字不该被误删」
//! 的用例必须按回显形态写全名字组。
use crate::db::migrate;
use crate::db::repos::notes::{update, NoteTag};
use rusqlite::{params, Connection};

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrate::run(&c).unwrap();
    c
}

fn count(c: &Connection, sql: &str, id: i64) -> i64 {
    c.query_row(sql, params![id], |r| r.get(0)).unwrap()
}

/// 真库形状:`地点/印度` --(名字点"状态")--> `状态/未完成`,外加一个普通标签 `甲/乙`,
/// 以及一条指向 /印度的无名字线（真库里 1917/三傻大闹宝莱坞 两篇都挂着它，
/// 于是删完出线后 /印度 不算空壳，不会被 gc_orphans 回收）。
/// 返回 (来源 id, 名线目标 id, 名字点 id)
fn seed(c: &Connection) -> (i64, i64, i64) {
    c.execute_batch(
        "INSERT INTO points(id, meta, created_at, path, depth) VALUES
           (1, '印度' || char(10), '2026-01-01', '地点/印度', 2),
           (2, '未完成', '2026-01-01', '状态/未完成', 2),
           (3, '状态', '2026-01-01', NULL, NULL),
           (4, '乙', '2026-01-01', '甲/乙', 2),
           (5, '1917', '2026-01-01', NULL, NULL),
           (6, '别的笔记', '2026-01-01', NULL, NULL);
         INSERT INTO lines(id, from_id, to_id, name_id, created_at) VALUES
           (10, 1, 2, 3, '2026-01-01'),
           (11, 5, 1, NULL, '2026-01-01'),
           (12, 6, 2, NULL, '2026-01-01');",
    )
    .unwrap();
    (1, 2, 3)
}

/// ① 主判据:删掉标签行保存后,那条有名线也消失(目标点本身还在)。
#[test]
fn removing_tag_text_removes_the_matching_named_line() {
    let mut c = db();
    let (src, to, _name) = seed(&c);
    // 编辑框回显 = 正文 + 非子级线目标路径(名线带名字组,composeSource 的形态)
    let kept = update(&mut c, src, "印度\n#状态/未完成(状态)").unwrap().unwrap();
    assert_eq!(
        kept.tags,
        vec![NoteTag { path: "状态/未完成".into(), relation_name: Some("状态".into()) }],
        "名线目标在编辑框里读成一个标签,且不重复;名字一起读回"
    );
    assert_eq!(count(&c, "SELECT COUNT(*) FROM lines WHERE from_id=?1", src), 1, "幂等保存不增线");
    // 用户把那一行删掉 -> 保存
    let after = update(&mut c, src, "印度\n").unwrap().unwrap();
    assert!(after.tags.is_empty(), "线删了,读回的标签也该空(旧实现这里还剩一条)");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM lines WHERE from_id=?1", src), 0, "有名线按目标集合一起替换");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM points WHERE id=?1", to), 1, "目标点自己还在,只是没了这条线");
}

/// ② 同一来源的其它关系不受影响。
#[test]
fn other_relations_of_the_same_source_survive() {
    let mut c = db();
    let (src, _to, _name) = seed(&c);
    crate::db::repos::tags::create_line(&mut c, src, 4, None).unwrap();
    let after = update(&mut c, src, "印度\n#甲/乙").unwrap().unwrap();
    assert_eq!(after.tags, vec![NoteTag::plain("甲/乙")], "名线走、别的线留");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM lines WHERE from_id=?1 AND to_id=4", src), 1);
}

/// ③ 目标还在期望集合里时,名线连名字一起原样保留(不能被重插抹成无名字线)。
#[test]
fn named_line_keeps_its_name_when_the_target_stays() {
    let mut c = db();
    let (src, to, name) = seed(&c);
    update(&mut c, src, "印度\n#状态/未完成(状态)").unwrap();
    let nid: Option<i64> = c
        .query_row(
            "SELECT name_id FROM lines WHERE from_id=?1 AND to_id=?2",
            params![src, to],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(nid, Some(name), "目标还在 -> 线原样保留,名字不丢");
}

/// ④ 名线目标不补重复的无名字线:否则卡片上两个同名 chip,且永远删不干净。
/// 无名字线被真删掉时(不在期望集合里)照旧替换语义。
#[test]
fn no_duplicate_nameless_line_for_a_named_target() {
    let mut c = db();
    let (src, to, _name) = seed(&c);
    update(&mut c, src, "印度\n#状态/未完成(状态)").unwrap();
    update(&mut c, src, "印度\n#状态/未完成(状态)").unwrap();
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM lines WHERE from_id=?1 AND to_id=2", src),
        1,
        "同一目标不落第二条线"
    );
    assert_eq!(
        count(&c, "SELECT COUNT(*) FROM lines WHERE from_id=?1 AND to_id=2 AND name_id IS NULL", src),
        0,
        "不该在名线之外再补一条同目标的无名字线"
    );
    let _ = to;
}
