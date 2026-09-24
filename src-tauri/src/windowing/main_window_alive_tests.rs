//! 主窗活性探针的纯逻辑测试(待办 #36)。
//! 只测可判定的部分:探针该不该做(豁免期)、回执登记。真实 webview 的探针链路由
//! `scripts/dev-issue36-accept.mjs` 在真机上验证。
use super::{BUILD_GRACE, last_build, note_built, record_ack, should_probe};
use std::time::{Duration, Instant};

#[test]
fn 从没建过窗时不探针() {
    assert!(!should_probe(Instant::now(), None));
}

#[test]
fn 刚建窗在豁免期内不探针() {
    let t0 = Instant::now();
    assert!(!should_probe(t0 + Duration::from_millis(50), Some(t0)));
    assert!(!should_probe(t0 + BUILD_GRACE - Duration::from_millis(1), Some(t0)));
}

#[test]
fn 过了豁免期才探针() {
    let t0 = Instant::now();
    assert!(should_probe(t0 + BUILD_GRACE, Some(t0)));
    assert!(should_probe(t0 + BUILD_GRACE + Duration::from_secs(60), Some(t0)));
}

#[test]
fn 建窗时刻会被记下并供探针判定读取() {
    let t0 = Instant::now();
    note_built(t0);
    let last = last_build();
    assert!(last.is_some(), "note_built 之后应能读到构建时刻");
    // 记下的时刻必须让「刚建窗」落在豁免期内(否则加载中的页面会被误判)
    assert!(!should_probe(t0, last));
    // 回执登记是纯副作用,这里验证它可重复调用且不改变构建时刻语义
    record_ack("t-1");
    record_ack("t-2");
    assert!(last_build().is_some(), "构建时刻不应被回执登记清掉");
}
