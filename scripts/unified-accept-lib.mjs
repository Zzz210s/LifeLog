// 统一输入框验收的共用动作件(自 dev-unified-input-accept.mjs 抽出,主脚本守 200 行红线)。
// 只做「CDP 键鼠 + DOM 读数」,不做断言 —— 每条读数的判定留在主脚本(计划 2/3、3/3 复用同一份)。
import { sleep } from './cdp-lib.mjs';

export const BOX = '[data-testid="unified-input"]';
export const HINT = '[data-testid="prefix-hint"]';
export const STAT = '[data-testid="prefix-stat"]';
export const DROP = '[data-testid="unified-dropdown"] li[role="option"]';
export const CHIP_AREA = '[aria-label="已生效的筛选条件"]';
export const SIDEBAR = 'aside[data-testid="sidebar"]';
export const FIXTURE_TAG = 'UI测试';
export const RECORD_TEXT = 'UI测试·记录';
export const FIXTURES = [`UI测试夹具一 #${FIXTURE_TAG}`, `UI测试夹具二 #${FIXTURE_TAG}`, 'UI测试夹具三'];
/** 11 条命令(shared/commands.ts 声明);只有这两条受 when(tabMultiple) 门控 */
export const COMMAND_IDS = [
  'note.new', 'tab.next', 'tab.prev', 'settings.open', 'theme.cycle', 'sidebar.toggle',
  'focus.mode', 'export.all', 'search.reindex', 'hotkey.edit', 'app.quit',
];
export const TAB_GATED = ['tab.next', 'tab.prev'];
export const EMPTY = { keyword: null, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null };
const VK = { enter: 13, esc: 27, a: 65, backspace: 8 };
const CTRL = 2;

/** 把一套「键盘/输入/读数」动作绑到一条 CDP 连接上(不共享可变状态) */
export function driver(cdp) {
  const ev = (expr) => cdp.eval(expr);
  const call = (cmd, args = {}) =>
    ev(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
  const key = async (vk, name, code, modifiers = 0) => {
    const base = { key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(200);
  };
  const focusBox = () =>
    ev(`(() => { const el = document.querySelector('${BOX}'); if (!el) return false; el.focus(); return true; })()`);
  /** 输入文本(合成文本插入,不碰物理键盘) */
  const type = async (text) => {
    await focusBox();
    await cdp.send('Input.insertText', { text });
    await sleep(420);
  };
  /** 清空输入框:真按键(Ctrl+A -> Backspace),不用合成 DOM 赋值 */
  const clearBox = async () => {
    await focusBox();
    await key(VK.a, 'a', 'KeyA', CTRL);
    await key(VK.backspace, 'Backspace', 'Backspace');
    return ev(`document.querySelector('${BOX}').value`);
  };
  /** 清空条件栏的全部 chip(点「移除条件」,不碰物理鼠标) */
  const clearChips = async () => {
    for (let i = 0; i < 6; i++) {
      const n = await ev(`(() => { const b = document.querySelector('${CHIP_AREA} [aria-label^="移除条件"]'); if (!b) return 0; b.click(); return 1; })()`);
      if (!n) break;
      await sleep(320);
    }
  };
  return {
    ev,
    call,
    key,
    enter: () => key(VK.enter, 'Enter', 'Enter'),
    ctrlEnter: () => key(VK.enter, 'Enter', 'Enter', CTRL),
    esc: () => key(VK.esc, 'Escape', 'Escape'),
    focusBox,
    type,
    clearBox,
    clearChips,
    boxValue: () => ev(`document.querySelector('${BOX}').value`),
    rows: () =>
      ev(`Array.from(document.querySelectorAll('${DROP}')).map((li) => ({ id: li.getAttribute('data-row-id'),
        label: li.textContent.trim(), checked: li.textContent.includes('已勾选') }))`),
    chips: () =>
      ev(`Array.from(document.querySelectorAll('${CHIP_AREA} [aria-label^="移除条件"]')).map((b) => b.getAttribute('aria-label').replace('移除条件 ', ''))`),
    streamCount: () => ev(`document.querySelectorAll('[data-note-body]').length`),
    stat: () => ev(`document.querySelector('${STAT}')?.textContent ?? null`),
    hits: async (keyword) => (await call('query_notes', { conditions: { ...EMPTY, keyword }, offset: 0 })).length,
    sidebar: () => ev(`!!document.querySelector('${SIDEBAR}')`),
    scrollToBottom: () =>
      ev(`(() => { const sc = document.querySelector('[data-note-body]')?.closest('.scroll-gutter');
        if (!sc) return -1; sc.scrollTop = sc.scrollHeight; return sc.scrollTop; })()`),
    /** 该笔记行是否落在信息流可视区内(顺带回传 scrollTop) */
    noteInView: (id) =>
      ev(`(() => { const el = document.querySelector('[data-note-body="${id}"]');
        if (!el) return { found: false };
        const sc = el.closest('.scroll-gutter');
        const a = el.getBoundingClientRect(), c = (sc ?? document.body).getBoundingClientRect();
        return { found: true, inView: a.top >= c.top && a.bottom <= c.bottom, scrollTop: sc?.scrollTop ?? -1 }; })()`),
    /** 可见的 input/textarea(宽高都非 0):主窗应当只剩统一输入框 */
    visibleInputs: () =>
      ev(`Array.from(document.querySelectorAll('input,textarea')).filter((el) => {
        const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0;
      }).map((el) => el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName)`),
    hintSegs: () =>
      ev(`Array.from(document.querySelectorAll('${HINT} [data-prefix]')).map((b) => ({ prefix: b.getAttribute('data-prefix'),
        active: b.getAttribute('data-active'), text: b.textContent.trim() }))`),
  };
}
