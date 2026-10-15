//! 裸括号谓词的用例(与前端 `src/shared/tag-label-paren.test.ts` 同表:三条用例名一致)。
//! 表格放在这里,是因为谓词是「名称合法性」与「关系名合法性」两侧的共同前提。
use super::has_bare_paren;

/// ① 未由行内 md 链接成对的括号一律算裸:段内配对之外的任何 `(` / `)` 都不行
#[test]
fn bare_paren_detects_unpaired() {
    for raw in [
        "工作(重要)",
        "(重点)",
        "a(b)c",
        "工作)",
        "工作(重点",
        "[郴](chēn)州市(别名)",
        "**a(b)**",
        "`a(b)`",
        "a]](b)",
    ] {
        assert!(has_bare_paren(raw), "应判裸括号:{raw}");
    }
}

/// ② 行内 md 链接消费掉的括号不算裸:真库唯一含括号的段名就是这个形态
#[test]
fn md_link_parens_are_not_bare() {
    for raw in ["[郴](chēn)州市", "[a](b)", "[郴](chēn)", "**重点**", "`代码`", "工作", "a/b", ""] {
        assert!(!has_bare_paren(raw), "不应判裸括号:{raw}");
    }
}

/// ③ 链接嵌在段内文本中间(前后都是字面文本)整体合法:路径里的 md 形态不是裸括号
#[test]
fn nested_link_in_segment_is_ok() {
    for raw in ["a[b](c)d", "地点/[郴](chēn)州市", "[a](b)[c](d)", "x[a(b)](c)y"] {
        assert!(!has_bare_paren(raw), "不应判裸括号:{raw}");
    }
}
