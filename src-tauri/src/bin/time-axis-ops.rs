//! 时间轴收敛 CLI 薄壳(设计 2026-10-12 §9.2 / 计划 T2):参数解析 + 退出码,逻辑全在
//! `lifelog_lib::time_axis`。
//!
//!   cargo run --features tools --bin time-axis-ops -- --db <副本> --phase tree           # dry-run
//!   cargo run --features tools --bin time-axis-ops -- --db <副本> --phase tree --apply   # 写副本
//!   --phase 取值:tree(S1 树收敛) / created-at(S2 created_at 修复) / both(顺序串跑)。
//!
//! 默认 dry-run(零写入);`--apply` 只允许写 `_lifelog-snapshots` 下的副本(真库阶段要 `--allow-live`)。
//! 退出码:0 成功 / 2 参数或前置不满足 / 3 自对账失败(已回滚)。
use lifelog_lib::time_axis::{self, Opts, Phase};
use std::path::PathBuf;

const USAGE: &str =
    "用法: time-axis-ops --db <副本路径> --phase tree|created-at|both [--apply] [--allow-live]";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println!("{USAGE}");
        return;
    }
    let opts = match parse(args) {
        Ok(o) => o,
        Err(msg) => fail(&msg, 2),
    };
    match time_axis::run(&opts) {
        Ok(lines) => {
            for line in lines {
                println!("{line}");
            }
        }
        Err(e) => fail(&e.message, e.code),
    }
}

fn parse(args: Vec<String>) -> Result<Opts, String> {
    let mut db: Option<PathBuf> = None;
    let mut phase: Option<Phase> = None;
    let mut apply = false;
    let mut allow_live = false;
    let mut it = args.into_iter();
    while let Some(flag) = it.next() {
        match flag.as_str() {
            "--db" => {
                let raw = it.next().ok_or_else(|| format!("--db 缺路径\n{USAGE}"))?;
                db = Some(PathBuf::from(raw));
            }
            "--phase" => {
                let raw = it
                    .next()
                    .ok_or_else(|| format!("--phase 缺取值\n{USAGE}"))?;
                phase = Some(Phase::parse(&raw).ok_or_else(|| {
                    format!("未知 --phase {raw}(支持 tree|created-at|both)\n{USAGE}")
                })?);
            }
            "--apply" => apply = true,
            "--allow-live" => allow_live = true,
            other => return Err(format!("未知参数 {other}\n{USAGE}")),
        }
    }
    let db = db.ok_or_else(|| format!("必须显式给 --db(不设默认库)\n{USAGE}"))?;
    let phase = phase.ok_or_else(|| format!("必须给 --phase\n{USAGE}"))?;
    Ok(Opts {
        db,
        phase,
        apply,
        allow_live,
    })
}

fn fail(msg: &str, code: i32) -> ! {
    eprintln!("{msg}");
    std::process::exit(code);
}
