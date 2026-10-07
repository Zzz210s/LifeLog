//! 保存路径的正文解析(自 notes.rs 拆出守 200 行上限):标签剥离、空白归一、解析入口与兜底候选。
use rusqlite::Connection;

/// 单行空白归一:保留行首空格/制表符(markdown 缩进语义),仅把行内连续空白折叠为一个空格,
/// 行尾空白丢弃;纯空白行归一为空行,保持空行结构
fn collapse_line(line: &str) -> String {
    let indent_len = line.len() - line.trim_start_matches([' ', '\t']).len();
    let (indent, rest) = line.split_at(indent_len);
    let body = rest.split_whitespace().collect::<Vec<_>>().join(" ");
    if body.is_empty() {
        String::new()
    } else {
        format!("{indent}{body}")
    }
}

/// 存库前移除 #标签 词元:用 `tags::tag_spans_known`(与 extract_tags 同一解析器)定位
/// **确认合法**的标签区间并只剥离这些区间;结构非法的 # 写法(如 `#工作/`、`#a//b`、`##标题`、
/// 行内/围栏代码块里的 #、`\#`)整串原样保留;空白/标点只是正常终止标签,不使其作废。
/// 起始于行首或紧跟空白之后的标签,额外吞掉其后的连续空格/制表符(不吞换行);
/// 最后逐行归一空白并保留行结构与行首缩进(多行笔记的换行、空行、嵌套列表缩进原样保留;
/// 标签折叠进 tags/tag_links,原文保留会双重展示)
pub(crate) fn strip_tags(content: &str) -> String {
    strip_tags_known(content, &[])
}

/// 同 [`strip_tags`],但带上"库内已存在的标签路径"做兜底(create/update 的保存路径专用):
/// 严格扫描失败的 `#` 处按最长匹配剥离 —— 不剥的话那行 md 源码会留在正文里变成死文本。
pub(crate) fn strip_tags_known(content: &str, known: &[String]) -> String {
    let content = content.replace("\r\n", "\n"); // 统一换行,防 Windows 端混入 \r
    let mut out = String::new();
    let mut cursor = 0usize;
    for span in crate::tags::tag_spans_known(&content, known) {
        out.push_str(&content[cursor..span.start]);
        // 仅当标签起始于行首或紧跟空白之后,才吞掉其后的连续空格/制表符:
        // 行首标签剥离后不留残余空白被误当缩进;
        // 行中标签(前面是词或标点)必须保留分隔空白,否则 "a-#tag b" 会粘连成 "a-b"、
        // "版本(#v2 备注)" 会粘连成 "版本(备注)",相邻文本被并成一个词(语义被改)。
        // 只吞空格/制表符,不吞换行,否则会把下一行并上来。
        let leading = out.chars().next_back().is_none_or(char::is_whitespace);
        cursor = span.end;
        if leading {
            while matches!(content[cursor..].chars().next(), Some(' ' | '\t')) {
                cursor += 1;
            }
        }
    }
    out.push_str(&content[cursor..]);
    out.split('\n').map(collapse_line).collect::<Vec<_>>().join("\n")
}

/// 保存路径(create / update)的**唯一解析入口**:正文 -> (标签路径, 剥净正文)。
/// 严格正文语法优先;只有严格失败的位置按**库内已存在的标签路径**做最长匹配兜底 ——
/// UI 编辑态回显的是原始路径(`#[郴](chēn)州市`),md 名字里的 `[` 不在正文名称字符集里,
/// 没有这一步就会静默丢标签、并把 md 源码写进正文(复现见 notes_save_fallback_tests)。
pub(crate) fn parse_saved(
    conn: &Connection,
    content: &str,
) -> rusqlite::Result<(Vec<String>, String)> {
    // 正文里一个 `#` 都没有 -> 严格扫描必无可剥离区间,兜底也无处施展:
    // 直接短路,省掉每次都去库上取一遍候选(全表 SELECT,实测 ≈0.4ms)。
    if !content.contains('#') {
        return Ok((Vec::new(), strip_tags(content)));
    }
    let known = known_tag_paths(conn)?;
    Ok((crate::tags::extract_tags_known(content, &known), strip_tags_known(content, &known)))
}

/// 兜底候选:库内**结构自洽**的标签路径(与 `tags::link::existing_id` 同一过滤 ——
/// 006 之前的"name 含 / 但无父节点"的幻影层级不参与,否则兜底会剥出一段没人链的文本)
fn known_tag_paths(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT path FROM entities WHERE kind = 'tag'
           AND (parent_id IS NOT NULL OR instr(path, '/') = 0)",
    )?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
}
