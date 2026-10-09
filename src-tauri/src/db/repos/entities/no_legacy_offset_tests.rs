//! 阶段 4 收口守卫:标签 id 整体偏移那套命名(旧常量标识符)在全仓源码里不再出现。
//!
//! 024 的 SQL 字面量与 027 钩子、历史迁移测试夹具各自保留**本地常量**(名字不同),
//! 所以「旧标识符命中数 = 0」就是收口完成的可机器判定形式;任何一处重新引入都会让本用例变红。
//! 扫描范围:后端 `src-tauri/src` 与前端 `src` 的 `.rs` / `.ts` / `.tsx`。
use std::path::{Path, PathBuf};

fn roots() -> Vec<PathBuf> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    vec![manifest.join("src"), manifest.join("../src")]
}

fn scan(dir: &Path, needle: &str, hits: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan(&path, needle, hits);
        } else if matches!(
            path.extension().and_then(|x| x.to_str()),
            Some("rs" | "ts" | "tsx")
        ) {
            if let Ok(text) = std::fs::read_to_string(&path) {
                for (i, line) in text.lines().enumerate() {
                    if line.contains(needle) {
                        hits.push(format!("{}:{}", path.display(), i + 1));
                    }
                }
            }
        }
    }
}

#[test]
fn no_tag_id_offset_remains() {
    // 拼出来而不是写字面量:本文件自己也在扫描范围内。
    let needle = ["TAG_ID", "OFFSET"].join("_");
    let mut hits = Vec::new();
    for root in roots() {
        scan(&root, &needle, &mut hits);
    }
    assert!(
        hits.is_empty(),
        "统一实体收口后旧偏移标识符不该再被引用(历史向量请用本地常量名):{hits:#?}"
    );
}
