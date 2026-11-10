# LifeLog for Obsidian

English | [简体中文](README.zh-CN.md)

Point/line notes inside Obsidian: every entry is a Markdown note, every tag or entity is a Markdown note,
named relations live in frontmatter, and **Bases** provides the database views. No SQLite, works on mobile.

Status: **0.1.0, early**. Not yet in the community plugin market.

## What it does

- **Capture bar** — a command that takes one line the way LifeLog does: `#tag`, `[[link]]`, `/command`, `>parent`.
- **Point/line file layout** — `拾枝/笔记/…` for entries, `拾枝/实体/…` for tree entities, frontmatter carries the ids.
- **Bases templates** — three `.base` files (stream, entities, relations) so you get table views with grouping and
  sorting out of the box, without any plugin-rendered UI.
- **Named relations** — `lifelog_relations: [{ name: 国籍, to: "[[地点/日本]]" }]`. Targets are wiki links on purpose:
  that is what makes Obsidian's **native graph** draw the edge, so no custom graph is needed.

## Install (manual, until it reaches the market)

1. Build: `pnpm install && pnpm build` → produces `main.js`.
2. Copy `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/lifelog/`.
3. Enable "LifeLog" in Settings → Community plugins.

## Use

1. Command palette → `LifeLog: 初始化库` (creates `拾枝/笔记`, `拾枝/实体`, `拾枝/.lifelog`).
2. Copy the three files from `templates/` into `拾枝/` to get the Bases views.
   Tree = Obsidian's own sidebar over `实体/文件夹`; graph = Obsidian's own graph view (relations are wiki links).
3. Command palette → `LifeLog: 捕获` → type `下午办驾照 #地点/印度 [[印尼驾照换发]]` → Enter.

Frontmatter contract:

```yaml
lifelog_id: 2141
lifelog_created: 2026-10-26T12:01:32
lifelog_parent: 时间/2026/10/26
lifelog_relations:
  - name: 国籍
    to: 地点/日本
```

## Roadmap

| Version | Content |
|---|---|
| 0.1.0 | init, capture, frontmatter contract, Bases templates |
| 0.2.0 | `import` command for an existing `lifelog.db` (desktop, sql.js read-only) |
| 0.3.0 | relation validation (a `name` must resolve to an entity note) |

## Importing an existing LifeLog database

Desktop: `pnpm dump:db "<path>/lifelog.db" lifelog-dump.json` (uses sql.js, read-only), then in Obsidian
run `LifeLog: 导入 lifelog.db 或 dump` and pick that file. Existing files are never overwritten — a `-2`,
`-3`… suffix is appended instead, and the notice reports created / renamed / skipped.

## Development

```bash
pnpm install
pnpm test        # 16 cases, pure TS (parser / indexer / schema)
pnpm typecheck
pnpm build       # -> main.js
```

`src/store/indexer.ts` and `src/capture/parse.ts` do not import `obsidian`, so they are unit-testable.

## License

MIT
