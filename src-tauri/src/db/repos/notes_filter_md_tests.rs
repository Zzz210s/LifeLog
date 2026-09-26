//! T3 库级端到端:「点侧栏一个 md 标签 -> 条件里带上它 -> 查询不报错」。
//! 走真库(内存 + 迁移)与真函数:tags::rename 造出 md 名字,条件对象带该路径,
//! notes_filter::validate + notes::query 都要放行并命中改名前的那篇笔记。
//! 这条用例是三处校验换口径的"功能真的能用"证据:把 validate 改回 parse_tag_path 立刻红。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes::{create_plain, query};
use crate::db::repos::tags::rename;
use rusqlite::Connection;

/// md 标签路径(与 T2 的界面改名同一形态)
const MD_PATH: &str = "地点/[郴](chēn)州市";

fn db() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    c
}

fn tag_id(c: &Connection, path: &str) -> i64 {
    c.query_row("SELECT id FROM tags WHERE path=?1", [path], |r| r.get(0)).unwrap()
}

fn cond(path: &str, include_children: bool) -> TagCond {
    TagCond { path: path.into(), include_children }
}

#[test]
fn md_tag_path_passes_validation_and_queries_notes() {
    let mut c = db();
    create_plain(&mut c, "甲 #地点/郴州市").unwrap();
    create_plain(&mut c, "乙 #无关").unwrap();
    // 侧栏把叶子名改成 md 形态(界面改名门在 T3 已放开,仓库存的就是 md 路径)
    let id = tag_id(&c, "地点/郴州市");
    rename(&mut c, id, "[郴](chēn)州市").expect("md 名字必须能改名");
    assert_eq!(tag_id(&c, MD_PATH), id, "仓库存的是 md 路径(别名不退化成节点)");

    // 引入侧:仅本级 / 含子级两种落笔方式都必须过校验且查到同一篇
    for include_children in [false, true] {
        let conditions = FilterConditions {
            tags: vec![cond(MD_PATH, include_children)],
            ..empty()
        };
        validate(&conditions).expect("md 路径必须通过条件校验");
        let notes = query(&c, &conditions, 0).expect("query_notes 不得报错");
        assert_eq!(notes.len(), 1, "含子级={include_children} 应命中改名前的同一篇笔记");
        assert_eq!(notes[0].content, "甲");
        assert_eq!(notes[0].tags, vec![MD_PATH.to_string()], "读回的标签路径就是 md 形态");
    }

    // 排除侧同一口径
    let excluded = FilterConditions {
        exclude_tags: vec![cond(MD_PATH, false)],
        ..empty()
    };
    validate(&excluded).expect("排除侧的 md 路径同样放行");
    let rest = query(&c, &excluded, 0).expect("query_notes 不得报错");
    assert_eq!(rest.len(), 1, "排除 md 标签后只剩无关笔记");
    assert_eq!(rest[0].content, "乙");
}

#[test]
fn structurally_invalid_paths_are_still_rejected() {
    // 放宽的只是段内 md 符号:结构类非法在后端权威校验里照旧拦下(中文原因不变)
    for bad in ["", "a//b", "a/", "/a", "工作 项目", "工作#项目", "a/b/c/d/e/f"] {
        let conditions = FilterConditions { tags: vec![cond(bad, true)], ..empty() };
        let err = validate(&conditions).expect_err(&format!("{bad:?} 必须被拦下"));
        assert!(err.starts_with("标签路径不合法"), "{bad:?} 的中文原因:{err}");
    }
}
