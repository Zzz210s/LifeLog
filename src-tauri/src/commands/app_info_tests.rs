//! 设置页计数口径(spec §6.6):「条目 N 条」= 全部实体(笔记与标签同表同权)。
use super::*;
use crate::db::migrate;
use crate::db::repos::notes::create_plain;

#[test]
fn db_info_counts_all_entities() {
    let mut c = Connection::open_in_memory().unwrap();
    migrate::run(&c).unwrap();
    assert_eq!(count_entities(&c).unwrap(), 0);

    // 一条含标签的笔记 = 1 笔记实体 + 1 标签实体,两者都计入条目
    create_plain(&mut c, "一条 #标签").unwrap();
    assert_eq!(count_entities(&c).unwrap(), 2, "标签实体也计入条目数");
}
