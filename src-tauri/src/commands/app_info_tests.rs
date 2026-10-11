//! 设置页计数口径(spec §6.6 / §7.2):「条目 N 条」= `COUNT(*) FROM points`
//! (笔记点与标签点同表同权;迁移 031 建的保留名字点 `子级` 也是 points 的一行,一并计入)。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes::create_plain;

#[test]
fn db_info_counts_all_entities() {
    let mut c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    // 迁移 031 落下的保留点 `子级`(id = 0)也算一行,与 spec §7.2 的真库读数 2120 同口径
    assert_eq!(count_entities(&c).unwrap(), 1, "空库 = 保留点一行");

    // 一条含标签的笔记 = 1 笔记点 + 1 标签点,再加保留点,共 3
    create_plain(&mut c, "一条 #标签").unwrap();
    assert_eq!(count_entities(&c).unwrap(), 3, "标签点与保留点都计入条目数");
}
