//! `parse_note_source` 与保存路径同源的属性测试:对共享 fixture 的每一条源码,
//! 命令输出必须等于"**真的存一条**同样源码的笔记后,从库里读回的正文与标签"
//! (内存库,绝不碰真实库),同时等于 fixture 声明 —— 命令、保存路径、向量三者一致。
//!
//! 注意口径(Important-2):命令与保存路径**共用同一个 `notes::parse_saved`**,
//! 因此"两者一致"是无条件成立的(而不是只在"库里没有可兜底路径"时才成立);
//! fixture 里的源码全是严格语法可解析的,故"等于 fixture"这条仍按原义成立。
//! 库内已有 md 形态路径时的一致由 `command_matches_save_with_md_path_in_library` 单独钉。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes::create_plain;
use crate::db::repos::notes::NoteTag;
use crate::db::repos::tags::rename;
use rusqlite::Connection;
use serde::Deserialize;

const TAG_GRAMMAR: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/tag-grammar.json"
));

#[derive(Deserialize)]
struct TagCase {
    source: String,
    content: String,
    tags: Vec<String>,
    /// 关系面(路径 + 名字):与 `tags_fixtures_tests` 同一份向量声明;缺省 = 该向量不声明名字
    #[serde(default)]
    lines: Option<Vec<FixtureLine>>,
}

#[derive(Deserialize)]
struct FixtureLine {
    path: String,
    name: Option<String>,
}

impl TagCase {
    /// 期望的标签线:`lines` 在就用它(带名字),否则由 `tags` 补成无名字线
    fn want(&self) -> Vec<NoteTag> {
        match &self.lines {
            Some(ls) => ls
                .iter()
                .map(|l| NoteTag { path: l.path.clone(), relation_name: l.name.clone() })
                .collect(),
            None => self.tags.iter().map(|t| NoteTag::plain(t)).collect(),
        }
    }
}

/// 断言用:标签线只取路径(与 fixture 的 `tags` 字段同形)
fn paths_of(tags: &[NoteTag]) -> Vec<&str> {
    tags.iter().map(|t| t.path.as_str()).collect()
}

fn memory_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    migrate::run(&conn).unwrap();
    // 阶段 4 起标签正文兜底读 `entities`,用例里的 `SELECT id FROM entities` 直接查新表。
    conn
}

#[test]
fn command_output_equals_actually_saved_note() {
    let mut conn = memory_db();
    let cases: Vec<TagCase> = serde_json::from_str(TAG_GRAMMAR).unwrap();
    assert!(cases.len() >= 25, "共享向量至少 25 条,实际 {}", cases.len());
    for (i, case) in cases.iter().enumerate() {
        let parsed = parse_source(&conn, &case.source).unwrap();
        // 真存一条:库里的返回值就是保存路径(create/update 同一对函数)的读数
        let saved = create_plain(&mut conn, &case.source).unwrap();
        assert_eq!(parsed.content, saved.content, "第 {i} 条正文与保存路径不一致:{:?}", case.source);
        assert_eq!(saved.content, case.content, "第 {i} 条正文与 fixture 不一致:{:?}", case.source);
        assert_eq!(parsed.tags, case.want(), "第 {i} 条标签(含名字)与 fixture 不一致:{:?}", case.source);
        // 名字**落库**(`lines.name_id`)属保存写入语义(T3):本任务只钉「解析层不丢名字」与路径一致
        assert_eq!(
            paths_of(&saved.tags),
            case.tags,
            "第 {i} 条保存的标签路径与 fixture 不一致:{:?}",
            case.source
        );
    }
}

/// 库内已有 md 形态路径时的向量(Important-2 的复现读数):
/// 库里的路径正是前端 `composeSource` 回显的**原始路径**,命令必须与保存路径给出同一读数 ——
/// 旧实现(严格 `tags::extract_tags`)在这里给 `tags=[]`,编辑面板显示「标签 0 个」。
/// 前置照 `notes_save_fallback_tests::seed_md_note`:先存普通路径,再改名成 md 形态
/// (md 名字里的 `[` 不在正文名称字符集里,所以它只可能从"库里已有"这一侧来)。
#[test]
fn command_matches_save_with_md_path_in_library() {
    let mut conn = memory_db();
    let mid = "地点/中国大陆/湖南省/郴chen州市";
    let leaf = "地点/中国大陆/湖南省/[郴](chēn)州市/宜章县";
    create_plain(&mut conn, &format!("莽山栈道 #{mid}/宜章县")).unwrap();
    let mid_id: i64 = conn
        .query_row("SELECT id FROM points WHERE path IS NOT NULL AND path=?1", [mid], |r| r.get(0))
        .unwrap();
    rename(&mut conn, mid_id, "[郴](chēn)州市").unwrap();

    let src = format!("莽山栈道\n#{leaf}");
    let parsed = parse_source(&conn, &src).unwrap();
    let saved = create_plain(&mut conn, &src).unwrap();
    assert_eq!(parsed.tags, vec![NoteTag::plain(leaf)], "命令必须认出库内已有的 md 路径");
    assert_eq!(parsed.content, "莽山栈道\n", "正文不得残留 md 源码");
    assert_eq!(parsed.tags, saved.tags, "命令与保存路径必须同读数(标签)");
    assert_eq!(parsed.content, saved.content, "命令与保存路径必须同读数(正文)");
}

#[test]
fn parse_result_carries_names() {
    let conn = memory_db();
    // 名字组经解析层落到 `NoteTag.relation_name`(设计 §5.2):前端编辑面板与 composeSource 都要它
    let r = parse_source(&conn, "#地点/中国大陆(国籍)").unwrap();
    assert_eq!(
        r.tags,
        vec![NoteTag { path: "地点/中国大陆".into(), relation_name: Some("国籍".into()) }]
    );
    assert_eq!(r.content, "", "名字组必须被剥净");
    // 无名与空组同读:`relationName` 都是 None(空组 = 清名字)
    let bare = parse_source(&conn, "#目标 #目标2()").unwrap();
    assert_eq!(
        bare.tags,
        vec![
            NoteTag { path: "目标".into(), relation_name: None },
            NoteTag { path: "目标2".into(), relation_name: None },
        ]
    );
}

#[test]
fn command_is_pure_and_preserves_source_untouched() {
    let conn = memory_db();
    let src = "记录 #工作/项目A 与 #生活".to_string();
    let before = src.clone();
    let r = parse_source(&conn, &src).unwrap();
    assert_eq!(src, before, "命令不得改写调用方传入的源码");
    assert_eq!(r.tags, vec![NoteTag::plain("工作/项目A"), NoteTag::plain("生活")]);
    assert_eq!(r.content, "记录 与");
}
