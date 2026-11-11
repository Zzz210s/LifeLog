# 拾枝 Obsidian 插件（已于 2026-10-29 并入主仓库）

这个目录原是独立仓库 `Zzz210s/obsidian-lifelog`，通过 `git subtree` 并入 `LifeLog/obsidian-plugin/`，
**历史完整保留**。独立仓库已归档为只读，后续开发与发版都在本仓库进行。

- 构建：`cd obsidian-plugin && pnpm install && pnpm build`（产出 `main.js`）
- 测试：`pnpm test`（64 例）
- 发版：在 `obsidian-plugin/` 打 tag（`v0.1.0` 形式），release 附 `main.js` / `manifest.json` / `styles.css`
- 设计与决策记录：`../docs/superpowers/specs/2026-10-2*-lifelog-plugin-*.md`
