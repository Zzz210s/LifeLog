// 侧栏「筛选标签」按钮的实机验收(统一输入框 2/3 · Task 4):
//   点击 → 统一输入框的值以 `#` 开头且是 activeElement(与快捷键共用同一条 prefill 通道);
//   侧栏里 0 个输入控件,点击也不会冒出来;在统一输入框里打字不改变侧栏标签行数(树不再按关键词过滤)。
// 前置:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 pnpm tauri dev
// 不碰物理鼠标:焦点与命中都走 DOM click / React 受控输入,不需要 OS 级输入。
import { ensureMain, recorder, waitFor } from './cdp-lib.mjs';

const SNAP = `(() => {
  const box = document.querySelector('[data-testid="unified-input"]');
  const aside = document.querySelector('aside');
  const btn = [...document.querySelectorAll('aside button')].find((b) => b.textContent.trim() === '筛选标签');
  return {
    sidebar: !!aside,
    button: !!btn,
    asideInputs: aside ? aside.querySelectorAll('input, textarea').length : -1,
    rows: aside ? aside.querySelectorAll('[data-tag-path]').length : -1,
    value: box ? box.value : null,
    focused: box ? document.activeElement === box : false,
  };
})()`;

const CLICK_FILTER = `(() => {
  const b = [...document.querySelectorAll('aside button')].find((x) => x.textContent.trim() === '筛选标签');
  if (!b) return false;
  b.click();
  return true;
})()`;

/** React 受控 textarea 的既有改值手法:原型 setter + input 事件 */
const TYPE = (text) => `(() => {
  const box = document.querySelector('[data-testid="unified-input"]');
  if (!box) return false;
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  set.call(box, ${JSON.stringify(text)});
  box.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;

const r = recorder();
const { cdp, close } = await ensureMain({});

// 先重载:dev 下 HMR 可能滞后,重载后模块与源码一致(主窗是单页,状态只来自设置与库)。
// 用 performance.timeOrigin 换值确认新文档已接管 —— 否则会读到重载前的旧上下文:
// 先 eval 到旧按钮 = true,紧接着快照却在重载空白期(第一条就假失败)。
const origin = await cdp.eval('performance.timeOrigin');
await cdp.send('Page.reload');
const fresh = await waitFor(async () => {
  const s = await cdp
    .eval(`(() => ({ t: performance.timeOrigin, has: !!document.querySelector('aside') }))()`)
    .catch(() => null);
  return s && s.t !== origin && s.has ? s : null;
}, 40, 250);
if (!fresh) throw new Error('重载后侧栏未在超时内出现(侧栏可能被设置隐藏)');

const before = await cdp.eval(SNAP);
r.record('侧栏在,按钮文案为「筛选标签」', before.sidebar === true && before.button === true, JSON.stringify(before));
r.record('初始:侧栏 0 个输入控件', before.asideInputs === 0, `aside 输入控件 ${before.asideInputs} 个`);
r.record('初始:标签行已渲染', before.rows > 0, `${before.rows} 行`);

r.record('点「筛选标签」', (await cdp.eval(CLICK_FILTER)) === true);

const after = (await waitFor(async () => {
  const s = await cdp.eval(SNAP);
  return s.value && s.value.startsWith('#') ? s : null;
}, 16, 250)) ?? (await cdp.eval(SNAP));
r.record('统一输入框的值以 # 开头', typeof after.value === 'string' && after.value.startsWith('#'), `value=${JSON.stringify(after.value)}`);
r.record('activeElement 是统一输入框', after.focused === true);
r.record('点击后:侧栏仍 0 个输入控件', after.asideInputs === 0, `aside 输入控件 ${after.asideInputs} 个`);
r.record('点击不改变标签行数', after.rows === before.rows, `${before.rows} -> ${after.rows}`);

// 在统一输入框里接着打字(等价于"用户在筛标签"):侧栏树不受影响(DOM 里过滤态已不存在)
await cdp.eval(TYPE('#zzz'));
const typed = await waitFor(async () => {
  const s = await cdp.eval(SNAP);
  return s.value === '#zzz' ? s : null;
}, 8, 150);
r.record('统一输入框可继续打字(#zzz)', typed !== null, `value=${JSON.stringify((typed ?? {}).value)}`);
r.record('打字后:侧栏标签行数不变(不再按关键词过滤)', (typed ?? after).rows === before.rows, `${before.rows} -> ${(typed ?? after).rows}`);
r.record('打字后:侧栏仍 0 个输入控件', (typed ?? after).asideInputs === 0);

// 收尾:清空并让焦点离开,免得后续门禁/审计读到带下拉的中间态
await cdp.eval(TYPE(''));
r.finish();
close();
