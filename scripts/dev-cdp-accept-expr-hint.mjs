#!/usr/bin/env node
/**
 * 表达式速查表与单 & | 报错的端到端取证(真实 UI + 真实 IPC validate_expr)。
 * 前置:以 9222 调试端口启动 pnpm tauri dev(冷启动即可,主窗由 ensureMain 前置自动打开):
 *   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 pnpm tauri dev
 * 用法: node scripts/dev-cdp-accept-expr-hint.mjs
 * 只读用例:只开对话框、改文本、Esc 关闭,不保存条件,故无需清收(库存靠前后对照证明)。
 */
import { ensureMain, recorder, sleep, waitFor } from './cdp-lib.mjs';
import { bindDom } from './cdp-dom.mjs';

const r = recorder();
const j = JSON.stringify;
const { cdp, close } = await ensureMain();
const { openAddCondition } = bindDom(cdp);

/** 受控 textarea 必须走原生 setter + input 事件,否则 React 的 onChange 不触发 */
const setExpr = (v) => cdp.eval(`(() => {
  const ta = document.querySelector('[role="dialog"] textarea[aria-label="表达式"]');
  if (!ta) return false;
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, ${j(v)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

const hasDialog = () => cdp.eval(`Array.from(document.querySelectorAll('[role="dialog"]')).some((d) => d.getAttribute('aria-label') === '表达式')`);

/** 对话框当前读数:文案行、红框、确定可用性、速查表补充说明是否同屏 */
const state = () => cdp.eval(`(() => {
  const dlg = Array.from(document.querySelectorAll('[role="dialog"]')).find((d) => d.getAttribute('aria-label') === '表达式');
  if (!dlg) return null;
  const ta = dlg.querySelector('textarea[aria-label="表达式"]');
  const line = dlg.querySelector('[aria-live="polite"]');
  const ok = Array.from(dlg.querySelectorAll('button')).find((b) => b.textContent.trim() === '确定');
  return {
    text: ta.value,
    danger: ta.className.includes('border-danger'),
    line: (line.textContent || '').trim(),
    preview: (line.textContent || '').includes('预览:'),
    confirmDisabled: ok.disabled,
    hint: dlg.textContent.includes('单个 & 或 | 不是运算符'),
  };
})()`);

const clickMenuItem = (text) => cdp.eval(`(() => {
  const m = Array.from(document.querySelectorAll('[role="menuitem"]')).find((x) => x.textContent.trim() === ${j(text)});
  if (!m) return false;
  m.click();
  return true;
})()`);

// H1 打开对话框:添加条件 -> 表达式(高级)
// 条件栏的「添加条件」触发按钮已随统一输入框 2/3 Task 2 搬走,入口改走 `>添加条件` 命令
const addBtn = await openAddCondition();
const menuItem = await clickMenuItem('表达式(高级)');
const up = await waitFor(async () => ((await hasDialog()) ? true : null), 20, 250);
r.record('H1 筛选栏「添加条件 -> 表达式(高级)」打开表达式对话框', addBtn === true && menuItem === true && up === true,
  j({ addBtn, menuItem, up }));

// H2 a&b:单 & 不是运算符 -> 中文报错 + 位置口径 +1 + 红框 + 确定禁用
await setExpr('a&b');
const bad = await waitFor(async () => { const s = await state(); return s && s.danger && s.text === 'a&b' ? s : null; }, 24, 250);
r.record('H2 a&b 报中文错误「第 2 个字符:缺少操作数」(0 起下标 +1 展示),红框 + 确定禁用',
  !!bad && bad.line.includes('第 2 个字符') && bad.line.includes('缺少操作数') && bad.confirmDisabled === true,
  j({ state: bad }));
r.record('H3 同屏速查表写明「单个 & 或 | 不是运算符」(用户可见文案与后端行为一致)', !!bad && bad.hint === true, '');

// H4 a|b 同样非法
await setExpr('a|b');
const bad2 = await waitFor(async () => { const s = await state(); return s && s.danger && s.text === 'a|b' ? s : null; }, 24, 250);
r.record('H4 a|b 同样报「第 2 个字符:缺少操作数」', !!bad2 && bad2.line.includes('第 2 个字符') && bad2.line.includes('缺少操作数'),
  j({ state: bad2 }));

// H5 a&&b:正确写法给绿色预览且确定可用
await setExpr('a&&b');
const good = await waitFor(async () => { const s = await state(); return s && s.preview && s.text === 'a&&b' ? s : null; }, 24, 250);
r.record('H5 a&&b 合法:绿色预览 + 确定可用', !!good && good.danger === false && good.confirmDisabled === false,
  j({ state: good }));

// H6 Esc 关闭不保存(用例不写库)
await cdp.eval(`(() => {
  const ta = document.querySelector('[role="dialog"] textarea[aria-label="表达式"]');
  if (ta) ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return true;
})()`);
const closed = await waitFor(async () => ((await hasDialog()) ? null : true), 12, 250);
r.record('H6 Esc 关闭且不保存(只读取证,不改条件与库存)', closed === true, '');

r.finish();
close();
