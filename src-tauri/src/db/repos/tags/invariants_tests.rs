//! 标签写入不变量测试台(spec 2026-09-21 D:标签写入路径收敛)。五组判据复用:
//! ① [`assert_fts_matches_tags`]:FTS 标签列 == 按 tag_links 聚合的路径 + 别名(唯一真源
//!    [`super::fts_tags::TAGS_AGG`],违反即"按显示文本搜不到、旧名仍命中"的静默漂移)。
//! ② [`assert_no_orphan_tags`]:无孤儿标签(无 tag_links 且无子节点)。
//! ③ [`assert_filter_paths_exist`]:filter_current 引用的每个标签路径都存在;只对"路径变化"类
//!    操作断言(删除按设计不改写条件 S7,留已删路径允许)。
//! ④ [`assert_no_dangling_carries`]:'tag' 行的 target_id 都指向存在的标签。
//! ⑤ [`assert_carry_acyclic`]:携带图无环(S3)。
use crate::db::repos::settings::{self, FILTER_CURRENT_KEY};
use crate::db::repos::tags::fts_tags::TAGS_AGG;
use crate::expr::lexer::{lex_spans, Token};
use rusqlite::{params, Connection, OptionalExtension};

/// ① 逐笔记比对;失败信息带笔记 id 与两侧取值(左侧 FTS 实值,右侧按链接重算)。
pub(crate) fn assert_fts_matches_tags(conn: &Connection) {
    let mut stmt = conn.prepare("SELECT id FROM notes ORDER BY id").unwrap();
    let ids: Vec<i64> = stmt
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    for id in ids {
        let expected: String = conn
            .query_row(
                &format!(
                    "SELECT {TAGS_AGG} FROM notes n WHERE n.id = ?1"
                ),
                params![id],
                |r| r.get(0),
            )
            .unwrap();
        let actual: Option<String> = conn
            .query_row("SELECT tags FROM notes_fts WHERE rowid = ?1", params![id], |r| r.get(0))
            .optional()
            .unwrap();
        assert_eq!(
            actual.as_deref(),
            Some(expected.as_str()),
            "笔记 {id} 的 FTS 标签列与 tag_links 聚合(路径+别名)不一致(FTS 实值 vs 按链接重算)"
        );
    }
    let stale: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT rowid FROM notes_fts WHERE rowid NOT IN (SELECT id FROM notes) ORDER BY rowid")
            .unwrap();
        stmt.query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    };
    assert!(stale.is_empty(), "notes_fts 残留已不存在的笔记行: {stale:?}");
}

/// ② 无孤儿标签(无 tag_id 链接、无指向它的携带行、无子节点);失败信息列出全部孤儿路径。
pub(crate) fn assert_no_orphan_tags(conn: &Connection) {
    let mut stmt = conn
        .prepare(
            "SELECT t.path FROM tags t
              WHERE NOT EXISTS (SELECT 1 FROM tag_links l WHERE l.tag_id = t.id)
                AND NOT EXISTS (SELECT 1 FROM tag_links lc WHERE lc.target_type = 'tag' AND lc.target_id = t.id)
                AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.tag_id = t.id)
                AND NOT EXISTS (SELECT 1 FROM tags c WHERE c.parent_id = t.id)
              ORDER BY t.path",
        )
        .unwrap();
    let found: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert!(found.is_empty(), "存在孤儿标签(无链接且无子节点): {found:?}");
}

/// ④ 无悬空携带行:target_type='tag' 的 target_id 都指向存在的标签(R5 的 delete_subtree/merge
/// 清行不彻底时报警;target_id 无外键,这是兜住它的唯一检查)。
pub(crate) fn assert_no_dangling_carries(conn: &Connection) {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM tag_links
              WHERE target_type = 'tag' AND target_id NOT IN (SELECT id FROM tags)",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 0, "存在悬空携带行(target_id 指向已不存在的标签)");
}

/// ⑤ 携带图无环(S3):任取一条携带边 a→b,若 b 沿携带方向能走回 a 即成环(2 环及以上都能查)。
pub(crate) fn assert_carry_acyclic(conn: &Connection) {
    let mut stmt = conn
        .prepare("SELECT tag_id, target_id FROM tag_links WHERE target_type = 'tag'")
        .unwrap();
    let edges: Vec<(i64, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    let cycles: Vec<String> = edges
        .into_iter()
        .filter(|&(a, b)| super::carry::reaches(conn, b, a).unwrap_or(false))
        .map(|(a, b)| format!("{a}->{b}"))
        .collect();
    assert!(cycles.is_empty(), "携带图存在环(S3 禁止): {cycles:?}");
}

/// ③ filter_current 引用的路径必须存在;键缺失/坏 JSON/坏条件一律跳过(与 filter_rewrite 同口径)。
pub(crate) fn assert_filter_paths_exist(conn: &Connection) {
    let Some(raw) = settings::get(conn, FILTER_CURRENT_KEY).unwrap() else {
        return;
    };
    let Ok(conds) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return;
    };
    let mut refs: Vec<String> = Vec::new();
    for key in ["tags", "excludeTags"] {
        for t in conds[key].as_array().into_iter().flatten() {
            if let Some(p) = t["path"].as_str() {
                refs.push(p.to_string());
            }
        }
    }
    if let Some(expr) = conds["expr"].as_str() {
        if let Ok(spans) = lex_spans(expr) {
            for (token, _, _) in spans {
                if let Token::Tag { path, .. } = token {
                    refs.push(path);
                }
            }
        }
    }
    let missing: Vec<&String> = refs
        .iter()
        .filter(|p| {
            conn.query_row("SELECT COUNT(*) FROM tags WHERE path = ?1", params![p], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap()
                == 0
        })
        .collect();
    assert!(missing.is_empty(), "filter_current 引用了不存在的标签路径: {missing:?}");
}

/// 路径变化类操作(改名)必须级联改写 filter_current,且改写后的引用真实存在(不变量③)。
#[test]
fn rename_cascades_filter_and_keeps_invariants() {
    let mut c = Connection::open_in_memory().unwrap();
    crate::db::migrate::run(&c).unwrap();
    crate::db::repos::notes::create_plain(&mut c, "会议记录 #工作/项目A").unwrap();
    let filter = r##"{"keyword":null,"tags":[{"path":"工作/项目A","includeChildren":true}],"excludeTags":[{"path":"工作","includeChildren":false}],"tagPresence":null,"sort":"newest","expr":"#工作/项目A"}"##;
    crate::db::repos::settings::set(&c, FILTER_CURRENT_KEY, filter).unwrap();
    let root = id_at(&c, "工作");

    crate::db::repos::tags::rename(&mut c, root, "事业").unwrap();

    let raw = crate::db::repos::settings::get(&c, FILTER_CURRENT_KEY).unwrap().unwrap();
    assert!(raw.contains("事业/项目A") && !raw.contains("工作"), "条件未级联: {raw}");
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
    assert_filter_paths_exist(&c);
}

/// 变异法可证伪:直接 `UPDATE tag_links SET tag_id` 制造漂移(tag_links 自 003 起没有
/// AFTER UPDATE 触发器,索引串不会跟着改),测试台必须报错 —— 证明它真能抓到"合并漏刷新"那类问题。
#[test]
fn fts_invariant_catches_manual_update_drift() {
    let mut c = Connection::open_in_memory().unwrap();
    crate::db::migrate::run(&c).unwrap();
    let note = crate::db::repos::notes::create_plain(&mut c, "x #甲").unwrap();
    let jia = id_at(&c, "甲");
    let yi = crate::db::repos::tags::ensure_path(&c, &["乙".to_string()]).unwrap();

    // 变异:绕开所有仓库层入口,直接改链接表
    c.execute("UPDATE tag_links SET tag_id = ?1 WHERE tag_id = ?2", params![yi, jia])
        .unwrap();

    let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| assert_fts_matches_tags(&c)))
        .expect_err("测试台必须抓到 UPDATE 造成的 FTS 漂移");
    let msg = panic_message(err);
    assert!(msg.contains(&format!("笔记 {}", note.id)), "报错要带笔记 id: {msg}");
    assert!(msg.contains('甲') && msg.contains('乙'), "报错要带两侧取值: {msg}");
    // 同一个变异也让孤儿检查报错(甲 已无链接且无子节点)
    let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| assert_no_orphan_tags(&c)))
        .expect_err("孤儿检查必须抓到被改空的 甲");
    assert!(panic_message(err).contains('甲'));
}

/// 测试台自身的读库入口:`SELECT id FROM tags WHERE path = ?1`
fn id_at(conn: &Connection, path: &str) -> i64 {
    conn.query_row("SELECT id FROM tags WHERE path = ?1", params![path], |r| r.get(0))
        .unwrap()
}

/// 取 panic 载荷里的报错文本(assert_eq! / assert! 的载荷是 String)
fn panic_message(payload: Box<dyn std::any::Any + Send>) -> String {
    payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| payload.downcast_ref::<&str>().map(|s| s.to_string()))
        .unwrap_or_else(|| "<非字符串 panic>".to_string())
}
