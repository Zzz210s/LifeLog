// T9 端到端验收脚本共用的动作件(键鼠走 CDP Input,不碰物理鼠标)。
// 拆出来的原因:A 组 8 场景 + B/C/D 组都要用同一套「按键 / 输入 / 状态读数 / 点击」,
// 场景文件受 200 行红线约束。
export const KEYS = {
  p: { key: 'P', code: 'KeyP', vk: 80 },
  k: { key: 'K', code: 'KeyK', vk: 75 },
  enter: { key: 'Enter', code: 'Enter', vk: 13 },
  esc: { key: 'Escape', code: 'Escape', vk: 27 },
  down: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
};
export const CTRL = 2, CTRL_SHIFT = 10, CTRL_ALT = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 浮层状态读数(统一口径;空态行没有 data-row-id,不计入 rows) */
const STATE = `(() => {
  const root = document.querySelector('[data-floating="palette"]');
  if (!root) return { present: false, open: false, badge: '', rows: [], empty: false, scrollTop: 0 };
  const rows = Array.from(root.querySelectorAll('li[role="option"][data-row-id]')).map((li) => ({
    id: li.getAttribute('data-row-id'), label: li.textContent.trim(),
    marks: li.querySelectorAll('mark').length, selected: li.getAttribute('aria-selected') === 'true' }));
  const inp = root.querySelector('input[role="combobox"]');
  return { present: true, open: !root.hidden, rows, empty: root.textContent.includes('无匹配结果'),
    badge: (inp?.getAttribute('aria-label') ?? '').replace('搜索', ''),
    scrollTop: root.querySelector('ul[role="listbox"]')?.scrollTop ?? 0 };
})()`;

/** 信息流滚动容器:仓里 .scroll-gutter 有 4 处(侧栏/设置页/编辑框/信息流),必须从笔记行反查 */
const SC = `document.querySelector('[data-note-body]')?.closest('.scroll-gutter')`;

export function helpers(cdp) {
  const press = async (k, modifiers = 0, wait = 260) => {
    const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers };
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(wait);
  };
  const type = async (text) => { await cdp.send('Input.insertText', { text }); await sleep(420); };
  const call = (cmd, args = {}) =>
    cdp.eval(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
  /** 真鼠标点击(CDP):先滚进视野,免得点到视口外的坐标上 */
  const clickSel = async (sel) => {
    const at = await cdp.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null; el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (!at) throw new Error('找不到可点元素:' + sel);
    for (const kind of ['mousePressed', 'mouseReleased'])
      await cdp.send('Input.dispatchMouseEvent', { type: kind, x: at.x, y: at.y, button: 'left', clickCount: 1 });
    await sleep(450);
  };
  const clickText = (text) => cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === ${JSON.stringify(text)});
    if (!b) return 'not-found'; b.click(); return 'clicked'; })()`);
  const state = () => cdp.eval(STATE);
  const palette = (kind) => press(KEYS.p, kind === 'palette' ? CTRL_SHIFT : CTRL);
  const esc = () => press(KEYS.esc);
  const scrollTop = () => cdp.eval(`${SC}?.scrollTop ?? -1`);
  const setScrollTop = (v) => cdp.eval(`(() => { const sc = ${SC}; if (!sc) return -1; sc.scrollTop = ${v}; return sc.scrollTop; })()`);
  const sidebar = () => cdp.eval(`!!document.querySelector('aside[data-testid="sidebar"]')`);
  const chips = () => cdp.eval(`Array.from(document.querySelectorAll('[aria-label="已生效的筛选条件"] span')).map((s) => s.textContent.trim())`);
  const liCount = () => cdp.eval(`document.querySelectorAll('li .md-body').length`);
  const alerts = () => cdp.eval(`Array.from(document.querySelectorAll('[role="alert"]')).map((e) => e.textContent.trim())`);
  const tagByPath = async (path) => (await call('list_tags')).find((t) => t.path === path) ?? null;
  /** 输入栏候选列表读数 */
  const suggest = () => cdp.eval(`(() => { const box = document.querySelector('[data-testid="tag-suggest"]');
    if (!box) return { open: false, rows: [] };
    return { open: true, rows: Array.from(box.querySelectorAll('[role="option"]')).map((b) => ({
      path: b.getAttribute('title'), marks: b.querySelectorAll('mark').length, pinned: b.getAttribute('data-pinned') === 'true' })) }; })()`);
  const setInputText = (v) => cdp.eval(`(() => { const el = document.querySelector('textarea[aria-label="输入栏内容"]');
    if (!el) return 'not-found'; el.focus(); el.value = ${JSON.stringify(v)};
    el.dispatchEvent(new Event('input', { bubbles: true })); return el.value; })()`);
  return { press, type, call, clickSel, clickText, state, palette, esc, scrollTop, setScrollTop,
    sidebar, chips, liCount, alerts, tagByPath, suggest, setInputText };
}
