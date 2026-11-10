# LifeLog for Obsidian

[English](README.md) | 简体中文

在 Obsidian 里做「点/线」笔记：每条记录是一个 Markdown 文件，每个标签/实体也是一个文件，
**有名关系**写在 frontmatter，**数据库视图交给 Bases**。不用 SQLite，手机端可用。

状态：**0.1.0，早期版本**，尚未上架社区插件市场。

## 它做什么

- **捕获栏**：一条命令，按原生 LifeLog 的前缀写 —— `#标签`、`[[链接]]`、`/命令`、`>父级`。
- **点/线文件结构**：`拾枝/笔记/…` 放条目，`拾枝/实体/…` 放树内实体，id 走 frontmatter。
- **Bases 模板**：三个 `.base` 文件（信息流 / 实体 / 关系），开箱就是能分组、能排序的表格视图，
  不靠插件自绘界面。
- **有名关系**：`lifelog_relations: [{ name: 国籍, to: 地点/日本 }]` —— 这是 Obsidian 原生图表达不了的东西。

## 安装（未上架前手动）

1. 构建：`pnpm install && pnpm build`，得到 `main.js`；
2. 把 `main.js`、`manifest.json`、`styles.css` 拷进 `<vault>/.obsidian/plugins/lifelog/`；
3. 设置 → 第三方插件 → 启用 LifeLog。

## 使用

1. 命令面板 → `LifeLog: 初始化库`（生成 `拾枝/笔记`、`拾枝/实体`、`拾枝/.lifelog`）；
2. 把 `templates/` 里的三个文件拷进 `拾枝/`，拿到 Bases 视图；
3. 命令面板 → `LifeLog: 捕获` → 输入 `下午办驾照 #地点/印度 [[印尼驾照换发]]` → 回车。

frontmatter 契约：

```yaml
lifelog_id: 2141
lifelog_created: 2026-10-26T12:01:32
lifelog_parent: 时间/2026/10/26
lifelog_relations:
  - name: 国籍
    to: 地点/日本
```

## 路线

| 版本 | 内容 |
|---|---|
| 0.1.0 | 初始化、捕获、frontmatter 契约、Bases 模板 |
| 0.2.0 | 树视图（本级/含子级计数） |
| 0.3.0 | 图视图（关系名边 + 共现边） |
| 0.4.0 | 导入已有 `lifelog.db`（桌面端，sql.js 只读） |

## 开发

```bash
pnpm install
pnpm test        # 16 例，纯 TS（解析器 / 索引器 / 契约）
pnpm typecheck
pnpm build       # -> main.js
```

`src/store/indexer.ts` 与 `src/capture/parse.ts` 不 import `obsidian`，因此可以直接单测。

## 许可

MIT
