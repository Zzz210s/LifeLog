// 验收脚本要用的「命令表 / 顶栏菜单条目」真源都在 TS 源码里,而 scripts/*.mjs 引不了 .ts:
// 与其在脚本里复制一份清单(命令表加一条就假红,本分支已踩五处),不如直接从源码文本里提。
// 覆盖两处:src/shared/commands.ts 的命令声明、src/main-window/shell/TopBarMenu.tsx 的 MENU_IDS。
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

/** 顶栏溢出菜单:条目 id 取 MENU_IDS(顺序即用户可见顺序),文案/勾选态取命令表(组件不重写文案) */
const MENU_IDS = (() => {
  const decl = /const MENU_IDS = \[([^\]]+)\]/.exec(src('src/main-window/shell/TopBarMenu.tsx'));
  if (decl === null) throw new Error('没在 TopBarMenu.tsx 里找到 MENU_IDS');
  return [...decl[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
})();

const byId = new Map(COMMANDS.map((c) => [c.id, c]));

export const MENU_ITEMS = MENU_IDS.map((id) => {
  const cmd = byId.get(id);
  if (cmd === undefined) throw new Error(`MENU_IDS 里的「${id}」不在命令表里`);
  return { id, label: cmd.title, toggled: cmd.toggled };
});

export const MENU_LABELS = MENU_ITEMS.map((m) => m.label);
