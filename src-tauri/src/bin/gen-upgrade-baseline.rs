//! 升级回归基线生成器(计划 T0.2 -> T3.5 / spec §5.3、§7.5)。
//!
//! 用法(仓库根 `src-tauri/` 下跑):
//!   cargo run --bin gen-upgrade-baseline
//!   cargo run --bin gen-upgrade-baseline -- --out ../fixtures/upgrade-regression.baseline.json
//!   cargo run --bin gen-upgrade-baseline -- --db <真库路径> --sample 300 --out <仓库外快照路径>
//!
//! 形状 `{source, why, content, expect:{citations,title}}`:`citations` = 该条落下的
//! `edges(kind='link')` 目标实体 id(fixture 条目按产品写路径现算;`--db` 条目直接读现成边)。
//! `--db` 以 SQLITE_OPEN_READ_ONLY 打开真库(零写入),输出只落仓库外的快照区
//! `F:\0-code\_lifelog-snapshots\`(公开仓库不收真库正文)。
use lifelog_lib::upgrade_regression::{self, baseline, BaselineEntry, COVERED_CATEGORIES, SOURCE_DB};
use std::path::{Path, PathBuf};

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
    let mut entries = match baseline::build_fixture_baseline(&cases) {
        Ok(e) => e,
        Err(e) => fail(&e),
    };
    if let Some(db) = args.db.as_deref() {
        match baseline::sample_db(db, args.sample) {
            Ok(mut extra) => entries.append(&mut extra),
            Err(e) => fail(&format!("抽样真库失败: {e}")),
        }
    }
    report_categories(&entries);
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
    let mut args = Args {
        db: None,
        fixture: None,
        out: None,
        sample: baseline::DEFAULT_SAMPLE,
    };
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        match flag.as_str() {
            "--db" => args.db = it.next().map(PathBuf::from),
            "--fixture" => args.fixture = it.next().map(PathBuf::from),
            "--out" => args.out = it.next().map(PathBuf::from),
            "--sample" => {
                let raw = it.next().unwrap_or_default();
                args.sample = raw.parse().unwrap_or(baseline::DEFAULT_SAMPLE);
            }
            other => fail(&format!("未知参数 {other}(支持 --db/--fixture/--out/--sample)")),
        }
    }
    args
}

/// 真库抽样的类别覆盖统计(只打印;fixture 条目的 `why` 不是类别,不参与计数)
fn report_categories(entries: &[BaselineEntry]) {
    let db: Vec<&BaselineEntry> = entries.iter().filter(|e| e.source == SOURCE_DB).collect();
    let mut hit = 0usize;
    for name in COVERED_CATEGORIES {
        let n = db.iter().filter(|e| e.why == name).count();
        if n > 0 {
            hit += 1;
        }
        eprintln!("真库抽样类别 {name}: {n} 条");
    }
    eprintln!("真库抽样共 {} 条,覆盖类别 {hit}/{}", db.len(), COVERED_CATEGORIES.len());
}
