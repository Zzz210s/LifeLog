// 验收脚本要用的「命令表」真源在 TS 源码里,而 scripts/*.mjs 引不了 .ts:
// 与其在脚本里复制一份清单(命令表加一条就假红,本分支已踩五处),不如直接从源码文本里提。
// 2026-10-07:顶栏 `⋯` 溢出菜单已删,原先从这里派生的 MENU_ITEMS/MENU_LABELS 随之移除。
import { readFileSync } from 'node:fs';

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/** 命令声明形如 `{ id: 'x', title: 'y', ... }`:出现顺序即命令表声明顺序,toggled 的有无即勾选态 */
const DECL = /id:\s*'([^']+)',\s*title:\s*'([^']+)'([^}]*)\}/g;

export const COMMANDS = [...src('src/shared/commands.ts').matchAll(DECL)].map((m) => ({
  id: m[1],
  title: m[2],
  toggled: /\btoggled:/.test(m[3]),
}));
if (COMMANDS.length === 0) throw new Error('没从 src/shared/commands.ts 提出任何命令(声明格式变了?)');

export const COMMAND_IDS = COMMANDS.map((c) => c.id);
