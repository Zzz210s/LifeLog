#!/usr/bin/env node
/**
 * 统一输入框 3/3 的定点读数(计划 Task 6 Step 3):三条本轮修复的端到端证据。
 *
 *  ① 200 条候选时按 ↑ 不越界:`aria-activedescendant` 只指向渲染窗口内的行
 *  ③ `#` 下拉开着时点顶栏 `⋯`:下拉被关掉(不同屏叠浮层)
 *
 * ② (标签采纳撤排除侧)不在这里做端到端:它的触发路径是"点笔记卡上那个已在排除侧的标签 chip",
 *    而该笔记已被排除条件过滤出信息流、根本不会渲染 —— 由单测 + 变异自证覆盖(见台账 task-2 报告),
 *    不在验收里造假数据去凑。
 *
 * 前置:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port> pnpm tauri dev
 * 本脚本只读界面 + 改输入框内容,不写库(结束前清空输入框)。
 */
import { ensureMain, recorder, sleep, waitFor } from './cdp-lib.mjs';

const { record, finish } = recorder();
const main = await ensureMain();
const d = main.cdp;

// 前置:上一轮脚本可能把主窗留在设置页 —— 先回信息流,否则输入框与顶栏菜单都不在
await d.eval(`(() => {
  // 「返回信息流」按钮没有 aria-label,只能按可见文本找
  const back = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '返回信息流');
  if (back) back.click();
  return true;
})()`);
await waitFor(async () => ((await d.eval(`!!document.querySelector('[data-testid="unified-input"]')`)) ? true : null), 12, 250);
const BOX = '[data-testid="unified-input"]';
const LIST = '[data-testid="unified-dropdown"]';
const MENU_BTN = '#root button[aria-label="更多操作"]'; // 溢出菜单的触发按钮(菜单面板只在打开时渲染)

/** 往输入框写入文本(非受控框:走原生 setter + input 事件,与真人输入同路径) */
async function type(text) {
  await d.eval(`(() => {
    const el = document.querySelector('${BOX}');
    el.focus();
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(400);
}
const press = (key) =>
  d.eval(`(() => {
    const el = document.querySelector('${BOX}');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
    return true;
  })()`);
const read = () =>
  d.eval(`(() => {
    const el = document.querySelector('${BOX}');
    const list = document.querySelector('${LIST}');
    const opts = list ? list.querySelectorAll('li[role="option"]') : [];
    return {
      value: el ? el.value : null,
      dropdown: !!list,
      options: opts.length,
      activeDescendant: el ? el.getAttribute('aria-activedescendant') : null,
      selected: list ? list.querySelectorAll('[aria-selected="true"]').length : 0,
      menu: !!document.querySelector('[data-testid="topbar-menu"]'),
    };
  })()`);

// ---------- ① 高亮不越界 ----------
await type('@');
let s = await read();
record('①-a `@` 空 query 出下拉且渲染 90 行', s.dropdown && s.options === 90, JSON.stringify({ options: s.options }));

await press('ArrowUp'); // 首行往上 = 渲染窗口的最后一行(不是候选的第 199 行)
await sleep(200);
s = await read();
const upOk = s.activeDescendant === 'unified-opt-89';
record('①-b 按 ↑ 落在渲染窗口末行(unified-opt-89),不是候选末行', upOk, JSON.stringify({ activeDescendant: s.activeDescendant, selected: s.selected }));

await press('ArrowDown'); // 89 -> 0(绕回渲染窗口开头,而不是候选的第 199 行)
await press('ArrowDown');
await press('ArrowDown'); // 0 -> 1 -> 2
await sleep(200);
s = await read();
record('①-c 从末行绕回后继续 ↓ 落在第 3 行(取模窗口 = 90 而非候选数)', s.activeDescendant === 'unified-opt-2', JSON.stringify({ activeDescendant: s.activeDescendant }));

// ---------- ③ 下拉与顶栏菜单不同屏 ----------
await type('#');
s = await read();
record('③-a `#` 出下拉', s.dropdown, JSON.stringify({ options: s.options }));

// 为什么这里派发**合成** focusout 而不是真的把焦点移到菜单按钮:
// CDP 驱动的主窗不是 OS 前台窗口(document.hasFocus() === false),Chromium 对非聚焦文档
// 只改 activeElement、**不发 focus/focusout 事件** —— 实测"真移焦点"下事件数 0,这条读数就永远
// 测不到实现。真焦点转移的行为由单测覆盖(src/main-window/unified/unified-focus-out.dom.test.ts
// 用真实 focusout + relatedTarget),这里验的是"处理器确实挂在真 DOM 上、真能关掉下拉"。
const menuClick = `(() => {
  const box = document.querySelector('${BOX}');
  const btn = document.querySelector('${MENU_BTN}');
  if (!box || !btn) return 'missing';
  box.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: btn }));
  btn.click(); // 同时把菜单真的打开,验证两者不再同屏
  return 'ok';
})()`;
await d.eval(menuClick);
await sleep(500); // 关闭被推迟一帧(见 use-close-on-focus-out)
const after = await read();
record('③-b 焦点离开输入区 -> 下拉关闭', after.dropdown === false, JSON.stringify({ dropdown: after.dropdown, menu: after.menu, value: after.value }));

// ---------- 收尾:关菜单、清输入框(不写库) ----------
await d.eval(`(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  return true;
})()`);
await sleep(300);
await type(''); // 走与真人打字同一条路径清空(非受控框:DOM 与 React state 一起改)
await waitFor(async () => ((await read()).value === '' ? true : null), 8, 200);
record('收尾:输入框已清空(未写库)', (await read()).value === '', '');

finish();
