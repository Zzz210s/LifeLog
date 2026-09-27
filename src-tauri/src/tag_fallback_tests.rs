//! 兜底匹配的纯逻辑读数:最长匹配、边界规则、零候选与空候选不越界。
use super::*;

fn hit(text: &str, known: &[&str]) -> Option<(String, usize)> {
    let chars: Vec<char> = text.chars().collect();
    let known: Vec<String> = known.iter().map(|s| s.to_string()).collect();
    longest_known(&chars, 0, &known)
}

#[test]
fn takes_the_longest_known_path() {
    // 祖先段也是节点:命中多条时取最长(短的那条也满足边界,不能先到先得)
    assert_eq!(
        hit("地点/中国大陆", &["地点", "地点/中国大陆"]),
        Some(("地点/中国大陆".to_string(), 7))
    );
    assert_eq!(
        hit("地点/中国大陆", &["地点/中国大陆", "地点"]),
        Some(("地点/中国大陆".to_string(), 7))
    );
    // 只有长的那条满足边界(短的那条后面紧跟 `/`),同样取长
    assert_eq!(
        hit("地点/中国大陆 备注", &["地点", "地点/中国大陆"]),
        Some(("地点/中国大陆".to_string(), 7))
    );
    assert_eq!(
        hit("[郴](chēn)州市/宜章县", &["[郴](chēn)州市", "[郴](chēn)州市/宜章县"]),
        Some(("[郴](chēn)州市/宜章县".to_string(), 15))
    );
}

#[test]
fn accepts_a_clean_boundary() {
    // 命中后是文末或非名称字符(空格、标点、md 符号)都算干净边界
    assert_eq!(hit("地点/中国大陆", &["地点/中国大陆"]), Some(("地点/中国大陆".to_string(), 7)));
    assert_eq!(
        hit("地点/中国大陆 备注", &["地点/中国大陆"]),
        Some(("地点/中国大陆".to_string(), 7))
    );
    assert_eq!(
        hit("[郴](chēn)州市", &["[郴](chēn)州市"]),
        Some(("[郴](chēn)州市".to_string(), 11))
    );
}

#[test]
fn rejects_partial_match_of_a_longer_text() {
    // 命中后紧跟 `/` 或名称字符 = 用户写的是更长的、库里没有的路径 -> 不认(不做部分剥离)
    assert_eq!(hit("地点/中国大陆/湖南省/[郴](chēn)州市", &["地点", "地点/中国大陆"]), None);
    assert_eq!(hit("不存在的路径", &["不存在"]), None);
    assert_eq!(hit("湖南省/宜章县[x]", &["湖南省"]), None);
}

#[test]
fn empty_candidates_never_match() {
    assert_eq!(hit("地点/中国大陆", &[]), None);
    assert_eq!(hit("地点/中国大陆", &[""]), None);
    // 候选比这段文本长时也不越界读
    assert_eq!(hit("地点", &["地点/中国大陆"]), None);
}
