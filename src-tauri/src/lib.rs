// 安卓 P0:移动端不会调用的桌面窗口函数(切换输入栏/托盘动作/自启修复等)在 mobile 档
// 必然是 dead code —— 它们在桌面档有用,不该为编译告警而删。
#![cfg_attr(not(feature = "desktop"), allow(dead_code))]
use tauri::Manager;

mod commands;
mod db;
mod exchange;
// 表达式纯逻辑层:validate 与 compile 被 db::repos::notes_filter 引用,
// describe 供 commands::expr::validate_expr 的实时预览;IPC 入口在 commands/expr.rs
mod expr;
mod hotkey;
mod hotkey_spec;
mod app_hotkey;
mod startup_report;

// 笔记间显式链接 `[[标题]]` 的语法解析与首行标题归一化(设计 D1/D2/D9);
// 纯函数,写入路径(notes::create_with / notes_update::update 经 note_links::replace_from_body)
// 与仓库层读取共用。
mod links;

// 共享测试向量(仓库根 fixtures/filter-conditions.json)的 Rust 侧断言:
// 与 src/shared/fixtures.test.ts 读同一份文件,探测两侧筛选取值漂移
#[cfg(test)]
#[path = "filter_fixtures_tests.rs"]
mod filter_fixtures_tests;

// 共享测试向量(仓库根 fixtures/hotkey-spec.json)的 Rust 侧断言:
// 与 src/shared/hotkey-match.test.ts / hotkey-keys.test.ts 读同一份文件,探测主键名与规范化漂移
#[cfg(test)]
#[path = "hotkey_fixtures_tests.rs"]
mod hotkey_fixtures_tests;

// 升级回归断言:当前解析输出 == fixtures/upgrade-regression.baseline.json(冻结基线)
#[cfg(test)] #[path = "upgrade_regression_tests.rs"] mod upgrade_regression_tests;
// 共享向量 fixtures/entity-link-targets.json 的 Rust 侧断言(统一元数据后 `[[ ]]` 目标裁决)
#[cfg(test)] #[path = "note_link_fixtures_tests.rs"] mod note_link_fixtures_tests;

// 标签名的行内 md 纯文本形态(label_plain)与界面改名校验(validate_label):
// 经 tags 上浮为 tags::label_plain / tags::validate_label,与正文语法 parse_tag_path 并列
mod tag_label;
// 解析口径(tokenizer + label_plain)自 tag_label 拆出以守 200 行红线,由 tag_label 再导出
mod tag_label_plain;
// 正文抽标签的兜底解析(严格语法失败处按库内已有路径最长匹配;唯一调用点是 tags::try_tag)
mod tag_fallback;
mod tags;
mod timetag;
// 升级回归基线(spec §5.3 / 计划 T0.2):迁移前解析结果冻结在 fixtures/upgrade-regression.baseline.json,
// 阶段 4 新实现对其逐字节比对;解析复用 tags/links,不新增第二套语法,基线与抽样都不存正文。
// 时间轴收敛引擎(S1 树收敛 + 后续 S2 created_at 修复的载具,设计 2026-10-12 §6);
// 公开面只有 `run`,CLI 薄壳是 `src/bin/time-axis-ops.rs`(`--features tools`)。
pub mod time_axis;
pub mod upgrade_regression;
mod windowing;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // 安卓 P0(2026-10-27):单实例/自启/全局快捷键/托盘都是桌面能力,整体挂 `desktop`。
    // 移动端把这一段整块跳过 —— 它们不是"编译期能空转"的插件,只能在调用点切掉。
    #[cfg(feature = "desktop")]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // 二次启动:唤起已运行实例的输入栏。用 show 而非 toggle —— 输入栏在启动时默认
            // 就是可见的,再次双击 exe 若走 toggle 会把用户眼前的输入栏隐藏掉(与 README 相反)。
            // 热键仍是切换语义(托盘左键自 2026-09-17 S1 起改为打开主窗口)。
            let _ = windowing::input::show(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        ;
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(commands::registry::handler())
        .setup(|app| {
            // identifier 由 app.lifelog 改为 com.lifelog.app 后,数据目录也随之改变:
            // 先把旧数据目录的数据库复制到新目录,再打开新库(只复制不移动,旧目录原样保留
            // 作回退)。失败与数据库初始化失败同等处理 —— 弹中文对话框说明原因并以退出码 1
            // 退出,绝不静默用空库继续(那会让用户以为数据丢了)。
            if let Err(reason) = db::data_dir_migration::migrate_for_app(app.handle()) {
                eprintln!("数据目录迁移失败(应用将以退出码 1 退出): {reason}");
                startup_report::show_failure(
                    app.handle(),
                    "数据目录迁移失败",
                    &db::OpenFailure {
                        reason,
                        backup: None,
                    },
                );
                return Ok(());
            }
            // 数据库初始化失败不能 panic(用户只会看到闪退、拿不到原因):弹中文对话框说明
            // 失败原因与已生成的备份,用户确认后以退出码 1 正常退出;迁移成功但备份失败时
            // 给一个不阻断的警告(应用照常可用)。
            match db::init(app.handle()) {
                Ok(report) => {
                    if let Some(warning) = report.backup_warning {
                        startup_report::show_backup_warning(app.handle(), &warning);
                    }
                }
                Err(failure) => {
                    eprintln!("数据库初始化失败(应用将以退出码 1 退出): {}", failure.reason);
                    if let Some(backup) = &failure.backup {
                        eprintln!("迁移前已生成的备份: {}", backup.display());
                    }
                    startup_report::show_failure(app.handle(), "数据库初始化失败", &failure);
                    return Ok(());
                }
            }
            // 改名兜底与托盘/全局快捷键:仅桌面(移动端没有自启项、托盘与全局热键)
            #[cfg(feature = "desktop")]
            {
            let current_name = app.package_info().name.clone();
            match commands::startup_legacy::adopt_legacy_entry(&current_name) {
                Ok(Some(legacy)) => eprintln!("自启项已从旧名 {legacy} 改名到 {current_name}"),
                Ok(None) => {}
                Err(e) => eprintln!("自启项改名兜底失败(可从设置页修复):{e}"),
            }
            // 旧几何键语义(含缩放的尺寸)一次性迁移到新语义(基础物理尺寸),单事务幂等
            windowing::input_geom::migrate_geometry(app.handle());
            windowing::tray::create(app)?;
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, _shortcut, event| {
                        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                            let _ = windowing::input::toggle(app);
                        }
                    })
                    .build(),
            )?;
            // 快捷键来自设置(input_hotkey):缺失/非法回退默认键,注册失败再回退默认键,
            // 两者都失败只写日志、不阻断启动(输入栏仍可从托盘唤起);
            // 生效值存进 LiveHotkey,供界面显示与后续改键决策读取
            app.manage(hotkey::LiveHotkey::default());
            let stored = hotkey::stored(app.handle());
            if let Err(e) = hotkey::apply(app.handle(), stored.as_deref()) {
                eprintln!("全局热键注册失败,输入栏仍可从托盘唤起:{e}");
            }
            } // #[cfg(feature = "desktop")] 结束
            #[cfg(not(feature = "desktop"))]
            app.manage(hotkey::LiveHotkey::default());
            // 启动动作只由设置决定(spec 3.1:手动启动与开机自启一致):
            // 「输入栏」唤起输入栏,「仅托盘」不显示任何窗口。主窗口只在首次使用引导未看过时自动打开
            // (见 windowing::startup::apply 末尾),其余情况不自动显示。
            // 自启插件会带 --minimized,该参数只作为「本次由自启拉起」的事实传入(当前不改变动作)。
            let autostart_launch = std::env::args().any(|a| a == "--minimized");
            windowing::startup::apply(app.handle(), autostart_launch);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
