//! 自启改名兜底的纯函数用例(注册表 I/O 不进单测:那会写用户真实的 Run 键)
use super::{pick_legacy_entry, LEGACY_ENTRY_NAMES};
use std::borrow::Cow;

fn names(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| (*s).to_string()).collect()
}

#[test]
fn 当前名下已有值时不采用任何旧名() {
    let existing = names(&["拾枝", "LifeLog"]);
    assert_eq!(pick_legacy_entry("拾枝", &existing), None);
}

#[test]
fn 只有旧名下有时采用最新的那个旧名() {
    let existing = names(&["LifeLog", "app-lifelog", "其他软件的项"]);
    assert_eq!(pick_legacy_entry("拾枝", &existing), Some("LifeLog"));
}

#[test]
fn 只有最老的旧名时也能采用() {
    let existing = names(&["app-lifelog"]);
    assert_eq!(pick_legacy_entry("拾枝", &existing), Some("app-lifelog"));
}

#[test]
fn 没有任何相关项时不采用() {
    let existing = names(&["PixPin", "Ditto"]);
    assert_eq!(pick_legacy_entry("拾枝", &existing), None);
}

#[test]
fn 当前名本身在旧名清单里时不会被当成旧名采用() {
    // 万一回到 LifeLog 这个名字,当前名下没有值、但枚举里有个同名项:不采用(否则会自己改自己)
    let existing = names(&["LifeLog"]);
    assert_eq!(pick_legacy_entry("LifeLog", &existing), None);
}

#[test]
fn 旧名清单与改名史一致() {
    assert_eq!(LEGACY_ENTRY_NAMES, &["LifeLog", "app-lifelog"]);
    // 值本身必须是 ASCII 或旧显示名:用于注册表键名,避免编码歧义
    for name in LEGACY_ENTRY_NAMES {
        let _: Cow<'_, str> = Cow::Borrowed(name);
        assert!(name.is_ascii());
    }
}
