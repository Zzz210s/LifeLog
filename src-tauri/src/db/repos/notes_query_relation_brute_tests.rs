//! 自 notes_query_relation_tests.rs 摘出(守 200 行红线):本模块是它的子模块,
//! 故 `use super::*` 直接可见父的全部夹具与用例助手(夹具不重复定义)。
use super::*;

/// ⑦ 大库形态等价性:多类型 × 多认领 × 各自子树 + 携带者,命中集必须与暴力枚举逐值一致。
/// 物化 id 集合若漏成员/多成员,这条会红。
#[test]
fn large_type_set_matches_brute_force() {
    let mut c = db();
    let guo = ensure_path(&c, &["国籍".into()]).unwrap();
    let suo = ensure_path(&c, &["所在".into()]).unwrap();
    for claimed in ["中国", "日本", "法国/巴黎", "地点/旧"] {
        let segs: Vec<String> = claimed.split('/').map(Into::into).collect();
        let id = ensure_path(&c, &segs).unwrap();
        set_tag_relation(&mut c, id, guo, "").unwrap();
    }
    let solo = ensure_path(&c, &["家".into()]).unwrap();
    set_tag_relation(&mut c, solo, suo, "").unwrap();

    let mut expected: Vec<String> = Vec::new();
    for (label, tag, hit) in [
        ("L0", "中国", true),
        ("L1", "中国/上海", true),
        ("L2", "日本", true),
        ("L3", "法国/巴黎", true),
        ("L4", "法国/巴黎/一区", true),
        ("L5", "法国/里昂", false),
        ("L6", "地点/旧/子", true),
        ("L7", "中国X", false),
        ("L8", "家", false),
        ("L9", "书", false),
    ] {
        create_plain(&mut c, &format!("{label} #{tag}")).unwrap();
        if hit {
            expected.push(label.to_string());
        }
    }
    // 携带者:作者/丸尾 携带 国籍 —— 它自己与后代命中,祖先不命中
    let author = ensure_path(&c, &["作者".into(), "丸尾".into()]).unwrap();
    set_tag_relation(&mut c, author, guo, "").unwrap();
    create_plain(&mut c, "L10 #作者/丸尾").unwrap();
    create_plain(&mut c, "L11 #作者/丸尾/甲").unwrap();
    create_plain(&mut c, "L12 #作者").unwrap();
    expected.extend(["L10".into(), "L11".into()]);
    expected.sort();

    assert_eq!(hits(&c, &include("国籍")), expected, "命中集必须与暴力枚举一致");
    assert_eq!(hits(&c, &include("所在")), vec!["L8"], "另一个类型只命中自己的认领");
}
