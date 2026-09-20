//! counts() 的 id 透出(MVP-3 Task 4):侧栏右键管理按 id 寻址
//! (rename_tag/move_tag/delete_tag/tag_impact 都收 tag_id),
//! list_tags 必须带出每个标签的行 id,否则前端拿不到管理入口。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes;
use rusqlite::Connection;

fn db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    migrate::run(&conn).unwrap();
    conn
}

#[test]
fn counts_returns_row_id_for_management() {
    let mut c = db();
    notes::create(&mut c, "开会 #工作/项目A").unwrap();
    let expected = ensure_path(&c, &["工作".into(), "项目A".into()]).unwrap();
    let list = counts(&c).unwrap();
    let leaf = list.iter().find(|t| t.path == "工作/项目A").unwrap();
    // 叶标签的 id 即 ensure_path 落库返回的行 id,右键管理可直接寻址
    assert_eq!(leaf.id, expected);
    // 父级同样带 id 且与叶子不同
    let parent = list.iter().find(|t| t.path == "工作").unwrap();
    assert_ne!(parent.id, leaf.id);
}
