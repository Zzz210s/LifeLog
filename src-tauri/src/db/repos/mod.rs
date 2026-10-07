pub mod carry_paths;
// 阶段 1–3 的脚手架:统一实体(`entities`/`edges`)的仓库层只被测试与后续任务调用,
// 生产读写路径要到阶段 4 才切过来。此间未使用项(对账常量/函数、计数结构)不算问题,
// 阶段 4 切换后应删掉这条 allow(先声明后建文件的子模块也靠它免告警)。
#[allow(dead_code)]
pub mod entities;
pub mod filter_rewrite;
pub mod graph;
pub mod note_links;
pub mod notes;
pub mod notes_hits;
pub mod settings;
pub mod tags;
