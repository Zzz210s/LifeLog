// 侧栏单击模式(`sidebar_click_mode`)的读写件。2026-10-17 侧栏头部的「点击行为」按钮已删,
// 界面不再有模式的 DOM 标记(`data-click-mode` 一级整套随按钮下线),模式真源 = settings 表。
//
// 两条路各有用途,别混:
// ① IPC `get_setting` / `set_setting` + 重载 —— 给不带界面的脚本用。侧栏状态只在挂载时读一次
//    (`use-sidebar-state` 的启动读回),写完**必须重载**页面才生效。
// ② 设置页 > 实体关系 > 「单击实体行的行为」那一行 —— 用户现在唯一的手动入口。点一下即生效
//    (走应用自己的 `changeClickMode`:落库 + 关预览卡片 + 一句中文回执),不需要重载。
// IPC 抛错 -> 'legacy'(旧构建),由调用方决定记红还是跳过;本文件不抛。
import { sleep, waitFor } from './cdp-lib.mjs';

export const MODE_KEY = 'sidebar_click_mode';
/** 两档制(2026-10-16 由三档减为两档);'select' 等旧值读回即回落 filter,库里旧值不被改写 */
export const CLICK_MODES = ['filter', 'open'];
export const MODE_LABEL = { filter: '筛选', open: '打开' };
export const SETTINGS_SECTION = '实体关系';
export const ROW_LABEL = '单击实体行的行为';
const J = JSON.stringify;
const ipcOf = (cdp, cmd, args) => cdp.eval(`(async () => await window.__TAURI_INTERNALS__.invoke(${J(cmd)}, ${J(args)}))()`);

/** 库里的原始值(不回落:旧值 'select' 也如实返回);IPC 不可用 -> null */
export const storedClickMode = (cdp) => ipcOf(cdp, 'get_setting', { key: MODE_KEY }).catch(() => null);

/** 生效模式 + 原始值:非法值与旧值一律回落 filter(与 use-sidebar-state 的 parseClickMode 同口径) */
export async function clickModeState(cdp) {
  const raw = await ipcOf(cdp, 'get_setting', { key: MODE_KEY }).catch(() => undefined);
  if (raw === undefined) return { mode: 'legacy', stored: null };
  return { mode: CLICK_MODES.includes(raw) ? raw : 'filter', stored: raw ?? null };
}
/** 只要生效模式(filter / open / legacy) */
export const clickModeOf = async (cdp) => (await clickModeState(cdp)).mode;

/** 重载并等外壳与侧栏首行就绪。先静置 600ms:让挂起的设置写回先落地
 *  (`use-filter-state` 的写回是 500ms 节流,重载时的卸载补写会盖回旧值)。 */
export async function reloadApp(cdp) {
  await sleep(600);
  await cdp.send('Page.reload', { ignoreCache: false });
  const shell = await waitFor(() => cdp.eval(`!!document.querySelector('#root [data-testid="unified-input"]')`).catch(() => false), 60, 250);
  await waitFor(() => cdp.eval(`!!document.querySelector('aside [data-tag-path]')`).catch(() => false), 20, 200);
  return !!shell;
}

/** 走 IPC 写模式 + 重载;返回切完的生效模式,'legacy' = IPC 不可用 */
export async function setClickMode(cdp, mode) {
  const ok = await ipcOf(cdp, 'set_setting', { key: MODE_KEY, value: mode }).then(() => true).catch(() => false);
  if (!ok) return 'legacy';
  await reloadApp(cdp);
  return clickModeOf(cdp);
}

/** 已经是 want 就不动(避免脚本中途重载丢掉界面态);legacy 原样返回,不抛 */
export async function ensureClickMode(cdp, want) {
  const cur = await clickModeOf(cdp);
  return cur === want || cur === 'legacy' ? cur : setClickMode(cdp, want);
}

/** 轮转一档(两档制:filter <-> open);返回切完的模式 */
export async function rotateClickMode(cdp) {
  const cur = await clickModeOf(cdp);
  if (cur === 'legacy') return cur;
  return setClickMode(cdp, cur === 'filter' ? 'open' : 'filter');
}

// ---------- 设置页那一行(手动入口) ----------
const ROW_GROUP = `document.querySelector('[role="group"][aria-label="${ROW_LABEL}"]')`;

/** 读那一行:选项文案 / 高亮项(aria-pressed)/ 整行文本(标签 + 说明 + 选项) */
export const clickModeRowState = (cdp) =>
  cdp.eval(`(() => { const g = ${ROW_GROUP}; if (!g) return null;
    const btns = Array.from(g.querySelectorAll('button'));
    const active = btns.find((b) => b.getAttribute('aria-pressed') === 'true');
    const row = g.parentElement?.parentElement;
    return { options: btns.map((b) => b.textContent.trim()),
      pressed: btns.map((b) => b.getAttribute('aria-pressed') === 'true'),
      active: active ? active.textContent.trim() : null,
      rowText: (row?.textContent ?? '').replace(/\\s+/g, ' ').trim() }; })()`);

/** 进设置页那一行所在分区(齿轮 -> 「实体关系」tab);已在设置页时齿轮不存在也不影响 */
export async function openClickModeRow(cdp) {
  await cdp.eval(`document.querySelector('button[aria-label="设置"]')?.click()`);
  await waitFor(() => cdp.eval(`!!document.querySelector('#root [role="tab"]')`).catch(() => false), 20, 200);
  const tab = `Array.from(document.querySelectorAll('#root [role="tab"]')).find((x) => x.textContent.trim() === ${J(SETTINGS_SECTION)})`;
  const ok = await cdp.eval(`(() => { const t = ${tab}; if (!t) return false; t.click(); return true; })()`);
  await waitFor(() => cdp.eval(`!!${ROW_GROUP}`).catch(() => false), 20, 200);
  return ok;
}

/** 点那一行的 want 档(用户路径,不重载);返回点后的读数行 + 库里的模式 + 侧栏回执 */
export async function pickClickModeRow(cdp, want) {
  const clicked = await cdp.eval(`(() => { const g = ${ROW_GROUP}; if (!g) return false;
    const b = Array.from(g.querySelectorAll('button')).find((x) => x.textContent.trim() === ${J(MODE_LABEL[want])});
    if (!b) return false; b.click(); return true; })()`);
  await sleep(300);
  return { clicked, row: await clickModeRowState(cdp), mode: await clickModeOf(cdp) };
}

/** 回信息流(顶栏视图导航的「信息流」;设置页的返回也是这条路) */
export const backToStream = (cdp) =>
  cdp.eval(`(() => {
    const b = Array.from(document.querySelectorAll('[data-testid="view-nav"] button')).find((x) => x.getAttribute('aria-label') === '信息流');
    if (b) { b.click(); return true; } return false; })()`);
