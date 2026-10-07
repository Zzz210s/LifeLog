//! T3.1 `ENTITIES_AGG`(`entities_fts.tag_paths` 的唯一真源)的行为读数。
//! ① 笔记分支 == 手写期望串(仅 `tagging` 边指向标签的路径 + 纯文本形态 + 别名);
//! ② 标签分支 == 自身完整路径(+ 纯文本形态 + 自身别名),普通标签不多空格;
//! ③ `refresh_entities_fts` 写出的行 == `ENTITIES_AGG` 直算的行。
//! (阶段 3 的「与老 `TAGS_AGG` 逐字节相同」对账随 027 下架老索引而退役,见 git 历史。)
use crate::db::migrate;
use crate::db::repos::entities::fts::ENTITIES_AGG;
use crate::db::repos::tags::invariants_tests::assert_fts_matches_edges;
use crate::db::repos::tags::tree::refresh_entities_fts;
use rusqlite::{params, Connection};

/// 某实体的聚合串(直算,不经 FTS 表)
fn agg(c: &Connection, id: i64) -> String {
    c.query_row(
        &format!("SELECT {ENTITIES_AGG} FROM entities e WHERE e.id = ?1"),
        params![id],
        |r| r.get(0),
    )
    .unwrap()
}

/// 小库:在最新库(27)上直接摆 `entities`/`edges`/`entity_aliases` / `entities_fts`。
/// 标签 3(`生活`)没有 `tagging` 边,用来钉「只算被链接的标签」。
fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c.execute_batch(
        "INSERT INTO entities(id,kind,name,content,created_at,path,depth) VALUES
           (1,'note',NULL,'正文','2026-01-01',NULL,NULL),
           (1000000001,'tag','地点','','2026-01-01','地点',1),
           (1000000002,'tag','[郴](chēn)州市','','2026-01-01','地点/[郴](chēn)州市',2),
           (1000000003,'tag','生活','','2026-01-01','生活',1);
         INSERT INTO edges(source_id,target_id,kind,created_at) VALUES
           (1,1000000001,'tagging','2026-01-01'),(1,1000000002,'tagging','2026-01-01'),
           (1000000001,1000000003,'child','2026-01-01');
         INSERT INTO entity_aliases(alias, entity_id) VALUES
           ('地方',1000000001),('郴',1000000002);",
    )
    .unwrap();
    c
}

/// ① 笔记分支:路径 + 纯文本路径(仅差异段)+ 别名,按各自 `ORDER BY` 排序,单空格相接。
#[test]
fn entities_agg_note_branch_aggregates_paths_plain_and_aliases() {
    let c = db();
    assert_eq!(
        agg(&c, 1),
        "地点 地点/[郴](chēn)州市 地点/郴州市 地方 郴",
        "笔记 tag_paths = tagging 边指向标签的路径 + 纯文本路径 + 别名(不含未链接的 生活)"
    );
}

/// ② 标签分支:自身完整路径(不是单段 name)+ 纯文本形态(仅当不同)+ 自身别名。
#[test]
fn entities_agg_tag_branch_uses_full_path() {
    let c = db();
    assert_eq!(agg(&c, 1000000003), "生活", "无 md、无别名的普通标签索引串就是路径本身(无多余空格)");
    assert_eq!(agg(&c, 1000000001), "地点 地方", "标签自身路径 + 自身别名");
    assert_eq!(
        agg(&c, 1000000002),
        "地点/[郴](chēn)州市 地点/郴州市 郴",
        "标签自身完整路径 + 纯文本形态 + 别名(用 e.name 只会出单段名)"
    );
}

/// ③ refresh_entities_fts 写出的行 == 直算;name/content 也按实体口径落库。
#[test]
fn refresh_entities_fts_matches_the_direct_aggregate() {
    let c = db();
    let ids = [1, 1000000001, 1000000002, 1000000003];
    refresh_entities_fts(&c, &ids).unwrap();
    let rows: Vec<(i64, String, String, String)> = {
        let mut stmt = c
            .prepare("SELECT rowid, name, content, tag_paths FROM entities_fts ORDER BY rowid")
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    };
    assert_eq!(rows.len(), ids.len(), "每个实体一行");
    for (id, name, content, tag_paths) in rows {
        let (want_name, want_content): (String, String) = c
            .query_row(
                "SELECT COALESCE(e.name, ''), e.content FROM entities e WHERE e.id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(name, want_name, "实体 {id} 的 name");
        assert_eq!(content, want_content, "实体 {id} 的 content");
        assert_eq!(tag_paths, agg(&c, id), "实体 {id} 的 tag_paths 必须 == ENTITIES_AGG 直算");
    }
    assert_fts_matches_edges(&c);
}
