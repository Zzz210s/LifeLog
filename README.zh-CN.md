[English](README.md) | 简体中文

# app-lifelog 生活数据库

本地优先的个人生活数据库:一条信息流记录一切,#标签自动归类,可搜索、筛选、导出 Excel。

日记、电影、小说、电视剧、待办、旅游笔记与计划都放在同一条信息流里。没有按领域划分的模块 ——
每条笔记就是一条记录,正文里的 `#标签` 自动完成归类。

## 目录

- [背景](#背景)
- [功能](#功能)
- [安装](#安装)
- [使用](#使用)
- [架构](#架构)
- [数据与存储](#数据与存储)
- [开发](#开发)
- [技术栈](#技术栈)
- [项目约定](#项目约定)
- [许可证](#许可证)

## 背景

个人日常记录的数据库,关键在两点:写进去要快、查出来要容易 —— 而不是多一套需要维护的分类体系。
现成的开源笔记服务大多要么为了 Web 技术栈牺牲启动速度(Electron、服务端 + 浏览器客户端),要么把
"记录"和"查找"拆成需要来回切换的功能。

本项目反其道而行:

- **记录就是一个搜索栏。** 全局热键唤起一条无边框置顶输入框 —— 只有一个输入字段,没有标题栏、
  没有按钮;输入、按 `Ctrl+Enter` 即入库。不用切窗口,也不用先选分类。
- **归类是推导出来的,不是声明的。** 没有文件夹、没有笔记类型、没有日记/影视/待办模块 ——
  只有一条流,加上从正文里解析出的 `#标签`。
- **查找就是筛选。** 全文搜索(SQLite FTS5,`trigram` 分词器,中文与词中匹配都能命中)、
  带计数的标签筛选、以及排序。
- **数据全在本地。** 用户目录下一个 SQLite 文件。没有账号、没有同步服务、不发起任何网络请求。
- **Excel 是逃生舱。** 整库导出为一个 `.xlsx`,数据不会因为软件消失而消失。

基于 Tauri 2 构建:可执行文件约 12 MB,安装包约 3 MB,不捆绑浏览器内核(使用系统的 WebView2)。

## 功能

**快捷输入窗**

窗口本身就是输入框:无边框、无标题栏、无按钮,方角透明。

- 全局热键 `Ctrl+Shift+Q` 唤起(热键被占用时自动回退到托盘菜单)
- 输入框铺满整个窗口:空输入时是一行,随内容自动长高,最多五行,再多就在框内滚动
- 光晕代替边框 —— 未聚焦:1px `rgba(0,0,0,0.12)` 描边 + `0 2px 10px` 浅阴影;
  聚焦:2px `rgba(59,130,246,0.65)` 蓝色描边 + `0 0 12px` 蓝色光晕
- 窗口最外 8 逻辑像素是拖动带,从任意边缘都能移动窗口;左右边缘改为拉伸宽度
  (240-900 逻辑像素,且不超过屏幕工作区的 80%)
- 默认贴纸模式:置顶常驻,失去焦点也不隐藏,可以一直开着(可在设置页改回失焦自动隐藏)
- `Esc`,或在拖动带上双击,隐藏窗口
- `Ctrl+Enter` 保存:输入框清空,右下角浅灰提示「已保存 HH:MM」并停留 1.5 秒,
  光标留在输入框,可以接着记下一条
- 滚轮直接缩放,50% 到 200%,无需按修饰键;`Ctrl` + 滚轮调透明度,30% 到 100%;
  中键恢复(缩放 100% + 设置里的默认透明度)
- 三档锁定(阻止移动 / 阻止关闭 / 锁定内容)都在设置页里;任一项锁定时右上角出现锁图标,
  点一下即可三档全部解锁
- 重启后恢复上次的位置、尺寸、缩放与透明度

**主窗口**

- 单列布局:顶部输入框、筛选栏、时间流
- 支持关键词筛选、标签筛选(点标签 chip 或笔记内的 `#标签`)、最新/最早排序,每页 50 条分页加载
- VSCode 式分屏编辑:左侧 Markdown 源码、右侧实时预览,`Ctrl+Enter` 保存
- 删除需要确认
- 顶栏齿轮进入内嵌设置页(信息流仍挂载在另一个分支,返回时不重查、滚动位置不丢):
  快捷输入 9 项设置,加一个通用区(版本号、数据库路径、打开所在文件夹、恢复快捷窗分区默认)

**笔记**

- `#标签` 从正文中提取并剥离,存入标签表与关联表,因此编辑时会同步更新关联关系
- Markdown 渲染(表格、任务列表、带语法高亮的围栏代码),全部经过唯一的消毒出口
- `#todo` 笔记显示复选框,勾选即把标签替换为 `#done`,取消勾选再换回来
- 时间显示精确到分钟,并带机器可读的 `datetime` 属性

**导出**

- 「导出全部」把整库写成一张 `.xlsx` 工作表(时间/正文/标签/创建时间)

## 安装

### 直接下载(Windows 11 x64)

从 [Releases](https://github.com/Zzz210s/app-lifelog/releases) 下载安装包(`*-setup.exe`)并运行;
缺少 WebView2 时安装器会自动引导安装。也可以只取其中的绿色版 `app-lifelog.exe`,双击即用。

### 从源码构建

前置:Node.js、pnpm、Rust 工具链,以及 Windows 上的 MSVC 构建工具。

```bash
pnpm install
pnpm tauri build
```

产物:

- `src-tauri/target/release/app-lifelog.exe` —— 绿色版可执行文件
- `src-tauri/target/release/bundle/nsis/app-lifelog_0.1.0_x64-setup.exe` —— 安装包

## 使用

1. 启动后主窗口出现,托盘图标出现在任务栏右下角。
2. 任意界面按 `Ctrl+Shift+Q` 唤起快捷输入窗。拖任意边缘可移动窗口,拖左右边缘改宽度,
   滚轮缩放,`Esc` 或双击边缘隐藏。
3. 输入内容,用 `#标签` 归类,例如:

   ```
   看了奥本海默,9 分 #电影
   买牛奶 #todo
   2026-09-11 阴,下午写完了迁移脚本 #日记
   ```

4. 按 `Ctrl+Enter`。笔记入库、输入框清空、提示「已保存 HH:MM」,主窗口自动刷新。
5. 在主窗口里:关键词搜索、点击标签筛选、切换排序、在分屏里编辑、勾选 `#todo` 待办,
   或把整库导出为 Excel。

托盘菜单:打开主窗口、快捷输入、退出。重复启动不会产生第二个实例 —— 它会唤起已运行实例的快捷输入窗。

开机自启由 Tauri 自启插件支持;由系统启动时带 `--minimized` 参数,直接进托盘而不弹主窗口。

## 架构

单进程 Tauri 应用:两个 webview 窗口 + 一层 Rust 命令层,全部状态存在 SQLite 里,前端不直接访问数据库。

![架构图](docs/architecture.zh-CN.svg)

- **前端(`src/`)** —— TypeScript + React,两个 Vite 入口:`index.html`(主窗)与 `quick.html`(快捷输入窗)。
  - `src/main-window/` —— 信息流界面:`App.tsx` 负责编排;`use-notes-feed.ts` 持有查询状态机
    (分页、请求序号、错误来源);`use-note-created.ts` 订阅后端事件,在快捷输入保存后刷新列表;
    `NoteStream`/`NoteItem`/`EditPanel` 负责渲染、筛选与编辑。
  - `src/quick-window/` —— `QuickCapture.tsx`(铺满窗口的单个 textarea)与它的行为 hook:
    `use-drag-band`(移动 / 双击)、`use-width-drag`(边缘拉伸宽度)、`use-auto-height`(1-5 行自动长高)、
    `use-quick-wheel` + `use-quick-view-store`(缩放、透明度与两者的落库)、`use-quick-settings`、
    `logical-size.ts`。
  - `src/main-window/settings/` —— 设置页的数据模型与两个分区。
  - `src/shared/` —— `api.ts`(带类型的命令封装)、`markdown.ts`(Markdown-it 管线与 DOMPurify 策略)、
    `links.ts`(外链交给系统浏览器)、`zoom.ts`、`note-source.ts`(创建与编辑共用的保存前归一)、`time.ts`,
    以及快捷窗的纯模型(`quick-geometry.ts`、`quick-gestures.ts`、`quick-lock.ts`、`quick-scale.ts`、
    `quick-settings.ts`、`quick-feedback.ts`)。
- **命令层(`src-tauri/src/commands/`)** —— 笔记、设置、窗口控制、导出的薄命令包装。
- **领域层(`src-tauri/src/`)** —— `tags.rs`(标签解析)、`db/repos/`(笔记增删改查、搜索查询、
  标签计数、设置)、`exchange/`(Excel 导出)、`windowing/`(托盘、全局热键、快捷窗几何与缩放)。
- **数据层(`src-tauri/src/db/`)** —— Tauri 状态里的一份共享 `Mutex<Connection>`,开启 WAL 日志、
  外键约束与 busy timeout;版本化 SQL 迁移放在 `db/migrations/`。

写入笔记在同一个事务里同时重建该笔记的标签关联;FTS 索引由 SQLite 触发器在插入、更新、删除时保持同步。

## 数据与存储

- 数据库:`%APPDATA%\app.lifelog\lifelog.db`(SQLite,WAL)。删除该文件即完全重置。
- 搜索索引:同一文件内的 FTS5 虚拟表,由触发器保持同步。
- Excel 导出:写到保存对话框指定的位置,不上传任何数据。

## 开发

```bash
pnpm install            # 安装依赖
pnpm tauri dev          # 开发模式(热更新)
pnpm tauri build        # 发布构建(启用 LTO)

pnpm typecheck          # tsc --noEmit
pnpm test               # vitest
cd src-tauri && cargo test
```

当前验证状态:前端 121 条测试、Rust 80 条测试,typecheck 与 build 通过。

通过 CDP 调试 webview:`pnpm tauri dev` 前设置
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`,再访问
`http://127.0.0.1:9222/json/list`。`scripts/dev-cdp.mjs` 是一个辅助脚本。

## 技术栈

| 层 | 选择 |
| --- | --- |
| 外壳 | Tauri 2(托盘图标、全局热键、开机自启、单实例、对话框、opener 插件) |
| 后端 | Rust、`rusqlite`(bundled SQLite)、`rust_xlsxwriter` |
| 前端 | React 19、TypeScript、Vite、Tailwind CSS 4 |
| Markdown | `markdown-it` + `markdown-it-task-lists`、DOMPurify、`highlight.js` |
| 测试 | 前端 Vitest(jsdom),Rust `cargo test` |
| 存储 | SQLite + FTS5(`trigram` 分词器) |

## 项目约定

这些约定在代码库中强制执行,而非仅作建议:

- 单个代码文件不超过 200 行,超出即拆模块
- 界面文案一律中文
- 源码、界面与提交信息中不出现 emoji
- 所有渲染出的 Markdown 必须经过同一个消毒组件
- 失败必须让用户可见,不允许静默吞掉
- `docs/superpowers/` 与 `.superpowers/`(设计与任务工作区)刻意不入库

## 许可证

[MIT](LICENSE)
