//! 标签写入不变量测试台(spec 2026-09-21 D:标签写入路径收敛)。
//! 三组判据,供既有与后续所有标签写入测试复用:
//! ① [`assert_fts_matches_tags`]:逐笔记比对 FTS 标签列与"按 tag_links 聚合的完整路径"。
//!    聚合口径必须与迁移 011 重建的触发器一致:`group_concat(t.path, ' ' ORDER BY t.path)`,
//!    无链接为空串 —— 违反即"按新名搜不到、旧名仍命中"的静默漂移。
//! ② [`assert_no_orphan_tags`]:无孤儿标签(既无 tag_links 又无子节点)。
//! ③ [`assert_tabs_paths_exist`]:settings.tabs_state 引用的每个标签路径(结构化 tags[] /
//!    excludeTags[] 与 expr token)都真实存在。只对"路径变化"类操作断言:删除按设计不改写
//!    条件(S7),留下已删路径是允许的。
use crate::db::repos::settings::{self, TABS_STATE_KEY};
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
                "SELECT COALESCE(group_concat(t.path, ' ' ORDER BY t.path), '')
                   FROM tags t JOIN tag_links l ON l.tag_id = t.id
                  WHERE l.target_type = 'note' AND l.target_id = ?1",
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
            "笔记 {id} 的 FTS 标签列与 tag_links 聚合不一致(FTS 实值 vs 按链接重算)"
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

/// ② 无孤儿标签;失败信息列出全部孤儿路径(便于定位是哪个容器没回收)。
pub(crate) fn assert_no_orphan_tags(conn: &Connection) {
    let mut stmt = conn
        .prepare(
            "SELECT t.path FROM tags t
              WHERE NOT EXISTS (SELECT 1 FROM tag_links l WHERE l.tag_id = t.id)
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

/// ③ tabs_state 里引用的每个标签路径都必须存在;失败信息列出全部悬空路径。
/// 键缺失 / 坏 JSON / 坏条件对象一律跳过(与 tabs_rewrite 的容错口径一致,不自作修复)。
pub(crate) fn assert_tabs_paths_exist(conn: &Connection) {
    let Some(raw) = settings::get(conn, TABS_STATE_KEY).unwrap() else {
        return;
    };
    let Ok(root) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return;
    };
    let mut refs: Vec<String> = Vec::new();
    for tab in root["tabs"].as_array().into_iter().flatten() {
        let Some(conds) = tab.get("conditions") else {
            continue;
        };
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
    assert!(missing.is_empty(), "tabs_state 引用了不存在的标签路径: {missing:?}");
}

/// 路径变化类操作(改名)必须级联改写 tabs_state,且改写后的引用真实存在(不变量③)。
#[test]
fn rename_cascades_tabs_and_keeps_invariants() {
    let mut c = Connection::open_in_memory().unwrap();
    crate::db::migrate::run(&c).unwrap();
    crate::db::repos::notes::create_plain(&mut c, "会议记录 #工作/项目A").unwrap();
    let tabs = r##"{"tabs":[{"title":"页","conditions":{"tags":[{"path":"工作/项目A","includeChildren":true}],"excludeTags":[{"path":"工作","includeChildren":false}],"expr":"#工作/项目A"}}],"activeIndex":0}"##;
    crate::db::repos::settings::set(&c, TABS_STATE_KEY, tabs).unwrap();
    let root = id_at(&c, "工作");

    crate::db::repos::tags::rename(&mut c, root, "事业").unwrap();

    let raw = crate::db::repos::settings::get(&c, TABS_STATE_KEY).unwrap().unwrap();
    assert!(raw.contains("事业/项目A") && !raw.contains("工作"), "条件未级联: {raw}");
    assert_fts_matches_tags(&c);
    assert_no_orphan_tags(&c);
    assert_tabs_paths_exist(&c);
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
