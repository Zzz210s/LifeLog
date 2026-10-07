//! 升级回归基线生成器(计划 T0.2 / spec §5.3)。
//!
//! 用法(仓库根 `src-tauri/` 下跑):
//!   cargo run --bin gen-upgrade-baseline
//!   cargo run --bin gen-upgrade-baseline -- --out ../fixtures/upgrade-regression.baseline.json
//!   cargo run --bin gen-upgrade-baseline -- --db <真库路径> --sample 300 --out <本地基线路径>
//!
//! `--db` 以 SQLITE_OPEN_READ_ONLY 打开真库(零写入),只抽正文;输出基线里
//! 不存正文,只存 `content_sha256` + 解析结果。
use lifelog_lib::upgrade_regression::{self, BaselineEntry, COVERED_CATEGORIES, SOURCE_DB, SOURCE_FIXTURE};
use rusqlite::{Connection, OpenFlags};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

const DEFAULT_SAMPLE: usize = 300;
const PER_CATEGORY: usize = 60;
const MAX_CONTENT_CHARS: usize = 200;

struct Args {
    db: Option<PathBuf>,
    fixture: Option<PathBuf>,
    out: Option<PathBuf>,
    sample: usize,
}

fn main() {
    let args = parse_args();
    let fixture = args.fixture.clone().unwrap_or_else(default_fixture);
    let cases = match upgrade_regression::load_cases(&fixture) {
        Ok(c) => c,
        Err(e) => fail(&e),
    };
    let mut entries: Vec<BaselineEntry> = cases
        .iter()
        .map(|c| upgrade_regression::entry_from(&c.content, SOURCE_FIXTURE, &c.why))
        .collect();
    if let Some(db) = args.db.as_deref() {
        match sample_db(db, args.sample) {
            Ok(mut extra) => entries.append(&mut extra),
            Err(e) => fail(&format!("抽样真库失败: {e}")),
        }
    }
    let mut json = serde_json::to_string_pretty(&entries).expect("序列化基线不会失败");
    json.push('\n');
    match args.out.as_deref() {
        Some(path) => {
            if let Err(e) = std::fs::write(path, json) {
                fail(&format!("写 {path:?} 失败: {e}"));
            }
            eprintln!("已写 {} 条基线 -> {}", entries.len(), path.display());
        }
        None => print!("{json}"),
    }
}

fn fail(msg: &str) -> ! {
    eprintln!("{msg}");
    std::process::exit(2);
}

fn default_fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/upgrade-regression.json")
}

fn parse_args() -> Args {
    let mut args = Args { db: None, fixture: None, out: None, sample: DEFAULT_SAMPLE };
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        match flag.as_str() {
            "--db" => args.db = it.next().map(PathBuf::from),
            "--fixture" => args.fixture = it.next().map(PathBuf::from),
            "--out" => args.out = it.next().map(PathBuf::from),
            "--sample" => {
                let raw = it.next().unwrap_or_default();
                args.sample = raw.parse().unwrap_or(DEFAULT_SAMPLE);
            }
            other => fail(&format!("未知参数 {other}(支持 --db/--fixture/--out/--sample)")),
        }
    }
    args
}

/// 只读抽样真库正文:按类别分桶(每类上限 PER_CATEGORY),按内容摘要去重 + 排序,
/// 结果与遍历顺序无关,便于阶段 4 用 diff 逐条比对。
fn sample_db(path: &Path, limit: usize) -> Result<Vec<BaselineEntry>, String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("只读打开 {} 失败: {e}", path.display()))?;
    let mut stmt = conn
        .prepare("SELECT content FROM entities WHERE kind = 'note' ORDER BY id")
        .map_err(|e| format!("准备查询失败: {e}"))?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| format!("查询失败: {e}"))?;
    let mut buckets: BTreeMap<&'static str, Vec<BaselineEntry>> = BTreeMap::new();
    let mut seen: HashSet<String> = HashSet::new();
    for row in rows {
        let raw = row.map_err(|e| format!("读取行失败: {e}"))?;
        if raw.contains("SAVEPROBE") {
            continue;
        }
        let content: String = raw.chars().take(MAX_CONTENT_CHARS).collect();
        let (tags, links, ..) = upgrade_regression::parse_content(&content);
        let category = upgrade_regression::categorize(&content, &tags, &links);
        let entry = upgrade_regression::entry_from(&content, SOURCE_DB, category);
        if !seen.insert(entry.content_sha256.clone()) {
            continue;
        }
        let bucket = buckets.entry(category).or_default();
        if bucket.len() < PER_CATEGORY {
            bucket.push(entry);
        }
    }
    let mut out: Vec<BaselineEntry> = buckets.into_values().flatten().collect();
    out.sort_by(|a, b| a.content_sha256.cmp(&b.content_sha256));
    out.truncate(limit);
    report_categories(&out);
    Ok(out)
}

fn report_categories(entries: &[BaselineEntry]) {
    let mut hit = 0usize;
    for name in COVERED_CATEGORIES {
        let n = entries.iter().filter(|e| e.why == name).count();
        if n > 0 {
            hit += 1;
        }
        eprintln!("真库抽样类别 {name}: {n} 条");
    }
    eprintln!("真库抽样共 {} 条,覆盖类别 {hit}/{}", entries.len(), COVERED_CATEGORIES.len());
}
