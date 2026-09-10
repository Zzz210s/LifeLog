use std::iter::Peekable;

/// 从文本提取 #标签: '#' 后由字母数字汉字与 -_/.· 组成,首字符须为字母数字汉字
pub fn extract_tags(content: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut chars = content.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '#' {
            if let Some(tok) = scan_tag_token(&mut chars) {
                if !out.contains(&tok) {
                    out.push(tok);
                }
            }
        }
    }
    out
}

/// 消费 '#' 之后的标签词元(词法同 extract_tags);裸 '#' 返回 None,不动迭代器
pub fn scan_tag_token(chars: &mut Peekable<std::str::Chars<'_>>) -> Option<String> {
    let mut tok = String::new();
    while let Some(&n) = chars.peek() {
        let ok_first = tok.is_empty() && n.is_alphanumeric();
        let ok_inner = !tok.is_empty()
            && (n.is_alphanumeric() || matches!(n, '-' | '_' | '/' | '.' | '·'));
        if ok_first || ok_inner {
            tok.push(n);
            chars.next();
        } else {
            break;
        }
    }
    if tok.is_empty() {
        None
    } else {
        Some(tok)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_chinese_and_ascii() {
        assert_eq!(
            extract_tags("看完 #流浪地球 特效不错 #sci-fi"),
            vec!["流浪地球", "sci-fi"]
        );
    }

    #[test]
    fn dedups_in_order() {
        assert_eq!(extract_tags("#a 先 #b 后 #a"), vec!["a", "b"]);
    }

    #[test]
    fn stops_at_punct_and_space() {
        assert_eq!(extract_tags("#tag,rest #tag2。结束"), vec!["tag", "tag2"]);
    }

    #[test]
    fn bare_hash_ignored() {
        assert!(extract_tags("# #! ##").is_empty());
    }

    #[test]
    fn inner_punct_kept() {
        assert_eq!(extract_tags("#a-b_c/d·e"), vec!["a-b_c/d·e"]);
    }
}
