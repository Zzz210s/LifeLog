//! 携带无环检查台的自证(自 tree_carry_tests.rs 抽出,守 200 行上限):
//! 绕开 set_tag_relation 的环校验直接造 2 环,检查台必须报警。
use super::*;

/// 变异自证:直接插 甲→乙、乙→甲(绕开 set_tag_relation 的环校验),无环检查台必须报警(能查 2 环)
#[test]
fn carry_acyclic_invariant_catches_manual_two_cycle() {
    let c = db();
    let a = ensure_path(&c, &segs(&["甲"])).unwrap();
    let b = ensure_path(&c, &segs(&["乙"])).unwrap();
    c.execute(
        "INSERT INTO edges(source_id, target_id, kind, remark, created_at)
         VALUES(?1,?2,'relation','',datetime('now','localtime')),
                (?2,?1,'relation','',datetime('now','localtime'))",
        params![a, b],
    )
    .unwrap();
    let hit = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| assert_carry_acyclic(&c)));
    assert!(hit.is_err(), "无环检查台必须抓到手工制造的 2 环");
}
