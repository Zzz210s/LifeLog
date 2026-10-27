// 侧栏单击行为(T6 逐格取证)的页面侧读数与操作原语:只读 DOM / IPC,写只走应用自己的写路径。
// 合成事件口径:修饰键点击用 `dispatchEvent(new MouseEvent('click', {ctrlKey/altKey/shiftKey}))`
// (实现读的就是这三个布尔),拖拽用合成的 DragEvent(与 dev-dnd-probe 同一套);只有真实鼠标
// 序列(拖拽落点几何)才必须走 CDP `Input.dispatchMouseEvent`,本脚本不做那类读数。
import { mkdirSync, writeFileSync } from 'node:fs';
import { sleep } from './cdp-lib.mjs';
import { openReadOnly, DB_PATH } from './db-compat.mjs';
// 侧栏单击模式(2026-10-17 头部按钮已删):读写与设置页那一行都在 click-mode-lib,这里只留转出与旧调用形状。
import { clickModeOf, clickModeRowState, ensureClickMode, openClickModeRow, pickClickModeRow, setClickMode, storedClickMode } from './click-mode-lib.mjs';
export { clickModeOf, clickModeRowState, ensureClickMode, openClickModeRow, pickClickModeRow, setClickMode, storedClickMode };

export const DB = DB_PATH;
export const SHOTS = '.superpowers/shots';
const J = JSON.stringify;
const rowSel = (p) => `document.querySelector('aside [data-tag-path=' + ${J(J(p))} + ']')`;

export const flashText = (cdp) => cdp.eval(`document.querySelector('[data-testid="tag-flash"]')?.textContent ?? null`);

export const modeOfSetting = (call) => call('get_setting', { key: 'sidebar_click_mode' }).catch(() => null);

/** 一行的全部读数(含展开证据:子行在不在 DOM 里由调用方另取) */
export const rowState = (cdp, p) =>
  cdp.eval(`(() => { const r = ${rowSel(p)}; if (!r) return null;
    return { path: r.getAttribute('data-tag-path'), pressed: r.getAttribute('aria-pressed'), cursor: r.getAttribute('data-cursor'),
      current: r.getAttribute('aria-current'), preview: r.getAttribute('data-preview'), controls: r.getAttribute('aria-controls'),
      bar: !!r.querySelector('[data-row-bar]'), selected: /bg-selected/.test(r.className), danger: /bg-danger-soft/.test(r.className) }; })()`);

export const rowExists = (cdp, p) => cdp.eval(`!!${rowSel(p)}`);

/** 单击一行;mods = {ctrl, alt, shift} */
export const clickRow = (cdp, p, mods = {}) =>
  cdp.eval(`(() => { const r = ${rowSel(p)}; if (!r) return false;
    r.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: ${!!mods.ctrl}, altKey: ${!!mods.alt}, shiftKey: ${!!mods.shift} }));
    return true; })()`);

/** 双击:两次 click + 一次 dblclick(浏览器真实序列) */
export const dblClickRow = (cdp, p) =>
  cdp.eval(`(() => { const r = ${rowSel(p)}; if (!r) return false;
    for (let i = 0; i < 2; i++) r.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: i + 1 }));
    r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 })); return true; })()`);

/** 拖拽起手 / 收手(合成 DragEvent;拖起后行内的 click 应被 dragActive 早退) */
const drag = (cdp, type, p) =>
  cdp.eval(`(() => { const r = ${rowSel(p)}; if (!r) return false;
    r.dispatchEvent(new DragEvent(${J(type)}, { bubbles: true, cancelable: true, dataTransfer: new DataTransfer(), clientX: 100, clientY: 100 }));
    return true; })()`);
export const dragStart = (cdp, p) => drag(cdp, 'dragstart', p);
export const dragEnd = (cdp, p) => drag(cdp, 'dragend', p);

/** 单击的「即时生效」读数:从派发 click 到行态(DOM)翻转的毫秒数 —— 走查「双击不延迟」。
 *  DB 落库另有 500ms 节流(`use-filter-state` 的 WRITE_DELAY_MS),故不拿它当延迟判据,只附读数。 */
export const clickDomLatency = (cdp, p) =>
  cdp.eval(`(async () => { const r = ${rowSel(p)}; if (!r) return null;
    const before = r.getAttribute('aria-pressed');
    const t0 = performance.now();
    r.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    let ms = null;
    for (let i = 0; i < 200; i++) { if (r.getAttribute('aria-pressed') !== before) { ms = +(performance.now() - t0).toFixed(1); break; } await new Promise((res) => setTimeout(res, 2)); }
    const t1 = performance.now();
    const raw0 = await window.__TAURI_INTERNALS__.invoke('get_setting', { key: 'filter_current' });
    let dbMs = null;
    for (let i = 0; i < 200; i++) { const v = await window.__TAURI_INTERNALS__.invoke('get_setting', { key: 'filter_current' });
      if (v !== raw0) { dbMs = +(performance.now() - t1).toFixed(1); break; } await new Promise((res) => setTimeout(res, 10)); }
    return { ms, dbMs, before, after: r.getAttribute('aria-pressed') }; })()`);

/** 底部光标条(select 档的组件,2026-10-16 已删):只作**反向读数**——恒应为 null */
export const cursorBar = (cdp) =>
  cdp.eval(`(() => { const b = document.querySelector('[data-testid="tag-cursor-bar"]'); if (!b) return null;
    return { text: b.textContent.replace(/\\s+/g, ' ').trim(), buttons: Array.from(b.querySelectorAll('button')).map((x) => x.getAttribute('aria-label')) }; })()`);

export const previewCard = (cdp) =>
  cdp.eval(`(() => { const c = document.querySelector('#tag-preview-card'); if (!c) return null;
    return { label: c.getAttribute('aria-label'), text: c.textContent.replace(/\\s+/g, ' ').trim(),
      buttons: Array.from(c.querySelectorAll('button')).map((x) => x.getAttribute('aria-label')),
      focused: !!document.activeElement && c.contains(document.activeElement) }; })()`);

export const clickCardButton = (cdp, label) =>
  cdp.eval(`(() => { const c = document.querySelector('#tag-preview-card'); if (!c) return false;
    const b = Array.from(c.querySelectorAll('button')).find((x) => x.getAttribute('aria-label') === ${J(label)});
    if (!b) return false; b.click(); return true; })()`);

/** 侧栏视角(tree / flat):读头部那颗「切换为…」按钮的 aria-label;拿不到那颗按钮 -> null */
export const sidebarView = (cdp) =>
  cdp.eval(`(() => { const b = document.querySelector('button[aria-label^="切换为"]'); if (!b) return null;
    return b.getAttribute('aria-label') === '切换为扁平列表' ? 'tree' : 'flat'; })()`);

/** 把侧栏拨到 want 视角(点头部那颗按钮,最多 3 次);返回拨完的读数。
 *  扁平模式下折叠集合对 DOM 没有影响(列表恒平铺),所以「双击 = 展开/收起」这类格必须先拨到树形。 */
export const ensureSidebarView = async (cdp, want) => {
  for (let i = 0; i < 3 && (await sidebarView(cdp)) !== want; i++) {
    await cdp.eval(`document.querySelector('button[aria-label^="切换为"]')?.click()`);
    await sleep(400);
  }
  return sidebarView(cdp);
};

/** 进设置页的某个分区:那一行只在对应分区的 DOM 里(默认停在「通用」,直接查会读到 undefined) */
export const openSettingsSection = async (cdp, label) => {
  const ok = await cdp.eval(`(() => { const t = Array.from(document.querySelectorAll('#root [role="tab"]'))
    .find((x) => x.textContent.trim() === ${J(label)}); if (!t) return false; t.click(); return true; })()`);
  await sleep(600);
  return ok;
};

export const esc = (cdp) => cdp.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

export const openMenu = (cdp, p, y = 140) =>
  cdp.eval(`(() => { const r = ${rowSel(p)}; if (!r) return false;
    r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: ${y} })); return true; })()`);

export const menuState = (cdp) =>
  cdp.eval(`(() => { const m = document.querySelector('[data-tag-menu]'); if (!m) return null; const box = m.getBoundingClientRect();
    return { items: Array.from(m.querySelectorAll('button')).map((b) => b.textContent.trim()),
      actions: Array.from(m.querySelectorAll('[data-menu-action]')).map((b) => b.getAttribute('data-menu-action')),
      relRows: m.querySelectorAll('[data-menu-relation]').length, scrollHeight: m.scrollHeight, clientHeight: m.clientHeight,
      maxH: getComputedStyle(m).maxHeight, boxH: +box.height.toFixed(1), top: +box.top.toFixed(1), bottom: +box.bottom.toFixed(1), vh: window.innerHeight }; })()`);

export const clickMenuItem = (cdp, action) =>
  cdp.eval(`(() => { const b = document.querySelector('[data-tag-menu] [data-menu-action=${J(action)}]'); if (!b) return false; b.click(); return true; })()`);

export const onSettings = (cdp) => cdp.eval(`!!document.querySelector('[role="tablist"][aria-label="设置分区"]')`);
export const openSettings = (cdp) => cdp.eval(`document.querySelector('button[aria-label="设置"]')?.click()`);
export const backToStream = (cdp) =>
  cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('[data-testid="view-nav"] button')).find((x) => x.getAttribute('aria-label') === '信息流');
    if (b) { b.click(); return true; } return false; })()`);

/** 一页读完的命中数(与应用同一 IPC / 同一条件对象) */
export const countHits = (cdp, conditions) =>
  cdp.eval(`(async () => { const T = window.__TAURI_INTERNALS__.invoke; const C = ${J(conditions)};
    let n = 0, off = 0, page; do { page = await T('query_notes', { conditions: C, offset: off }); n += page.length; off += 50; } while (page.length === 50);
    return n; })()`);

export const scrollTo = (cdp, p) => cdp.eval(`(() => { const r = ${rowSel(p)}; if (!r) return false; r.scrollIntoView({ block: 'center' }); return true; })()`);

/** 截图(存 .superpowers/shots/clickmode-*.png) */
export async function shot(cdp, name) {
  mkdirSync(SHOTS, { recursive: true });
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = `${SHOTS}/clickmode-${name}.png`;
  writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

/** 库基线(v31 真表名;只读)+ 本脚本夹具点数 */
export const dbBase = () => {
  const c = openReadOnly(DB);
  const n = (sql) => c.prepare(sql).get().n;
  const out = { points: n('select count(*) n from points'), lines: n('select count(*) n from lines'),
    fixturePoints: n("select count(*) n from points where path like '单击验收%'"),
    uv: c.prepare('pragma user_version').get().user_version, integrity: c.prepare('pragma integrity_check').get().integrity_check };
  c.close();
  return out;
};

/** 夹具标签(建/删都走应用 IPC;`单击验收/父` 是计数 0 的容器行) */
export const FIXTURE = {
  note: '单击验收夹具笔记',
  parent: '单击验收/父',
  child: '单击验收/父/子',
};
