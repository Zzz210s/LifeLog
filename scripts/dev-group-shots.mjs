// 分组 UI 真机取证(T5):按「地点」分组 -> 截屏(组头 + 条数 + 组内卡片);
// 折叠首组 -> 截屏(别组不受影响);条件栏分组 chip/入口 -> 截屏。
// 用法:LIFELOG_CDP_PORT=9333 node scripts/dev-group-shots.mjs(先起 pnpm dev + 带 9333 的 dev 二进制)
import { mkdirSync, writeFileSync } from 'node:fs';
import { ensureMain, sleep, waitFor } from './cdp-lib.mjs';

const OUT = '.superpowers/shots';
mkdirSync(OUT, { recursive: true });

const { cdp } = await ensureMain();
await cdp.send('Page.enable');
const evalJs = (expr) => cdp.eval(expr);
// 重载主窗:把上一次遗留的浮层/面板 React 状态清掉(条件从 settings 回读,不受影响)
await cdp.send('Page.reload', { ignoreCache: false });
await sleep(2500);
await waitFor(async () => evalJs(`!!document.querySelector('#root [data-testid="unified-input"]')`), 40, 250);
await sleep(500);
const shot = async (name) => {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'));
  return `${OUT}/${name}.png`;
};

// 1) 回信息流并清空已有筛选(移除所有条件 chip)
await evalJs(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 4; i++) {
    const back = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '返回信息流');
    if (back) { back.click(); await sleep(500); continue; }
    if (document.querySelector('[data-testid="graph-view"]')) { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(400); continue; }
    break;
  }
  for (let i = 0; i < 16; i++) {
    const b = document.querySelector('[aria-label="已生效的筛选条件"] [aria-label^="移除条件"]');
    if (!b) break;
    b.click(); await sleep(300);
  }
  return true;
})()`);

// 2) 打开「添加条件」菜单 -> 分组面板 -> 选轴「地点」
const setup = await evalJs(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const box = document.querySelector('#root [data-testid="unified-input"]');
  if (!box) return { ok: false, why: '没有统一输入框' };
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  set.call(box, '>添加条件'); box.dispatchEvent(new Event('input', { bubbles: true }));
  const rows = () => [...document.querySelectorAll('#root [data-testid="unified-dropdown"] li[role="option"]')].filter((li) => li.textContent.includes('添加条件'));
  let row = rows()[0];
  for (let i = 0; i < 12 && !row; i++) { await sleep(250); row = rows()[0]; }
  if (!row) return { ok: false, why: '没有「>添加条件」候选行' };
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  await sleep(600);
  set.call(box, ''); box.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(200);
  const item = [...document.querySelectorAll('#root [role=menuitem]')].find((b) => b.textContent.trim() === '分组');
  if (!item) return { ok: false, why: '菜单里没有「分组」项' };
  const menuItems = [...document.querySelectorAll('#root [role=menuitem]')].map((b) => b.textContent.trim());
  item.click(); await sleep(300);
  const add = document.querySelector('#root [data-testid="group-add"]');
  if (!add) return { ok: false, why: '分组面板没有「+ 分组轴」' };
  add.click(); await sleep(700);
  const dlg = document.querySelector('#root [role=dialog][aria-label="添加标签"]');
  if (!dlg) return { ok: false, why: '标签选择器未出现' };
  const tagRow = [...dlg.querySelectorAll('ul button')].find((b) => b.textContent.trim().startsWith('地点'));
  if (!tagRow) return { ok: false, why: '标签选择器里没有「地点」' };
  tagRow.click();
  return { ok: true, menuItems };
})()`);
console.log('setup:', JSON.stringify(setup));
if (!setup?.ok) { cdp.close(); process.exit(1); }

const got = await waitFor(async () => (await evalJs(`document.querySelectorAll('#root [data-testid="group-header"]').length`)) > 0, 40, 300);
console.log('组头出现:', got);
await sleep(600);

const readGroups = `(() => [...document.querySelectorAll('#root [data-testid="group-section"]')].slice(0, 8).map((s) => ({
  head: s.querySelector('[data-testid="group-header"]')?.textContent.trim(),
  notes: s.querySelectorAll('li').length,
})))()`;
const groups = await evalJs(readGroups);
const chip = await evalJs(`(() => { const c = [...document.querySelectorAll('[aria-label="已生效的筛选条件"] span')].map((s) => s.textContent.trim()).find((t) => t.startsWith('分组')); return c ?? null; })()`);
console.log('分组读数:', JSON.stringify({ chip, groups }));
// 3) 菜单还开着:截「分组入口 + 方向/清除 + 条件栏 chip」
const p3 = await shot('group-03-chip');

// 4) Esc 关菜单 -> 干净的分组视图(组头 + 条数 + 组内卡片)
await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(500);
const p1 = await shot('group-01-place');

// 5) 点首组组头折叠 -> 截屏
await evalJs(`(() => { const h = document.querySelector('#root [data-testid="group-header"]'); h.click(); return true; })()`);
await sleep(500);
const afterFold = await evalJs(`(() => { const secs = [...document.querySelectorAll('#root [data-testid="group-section"]')];
  return { first: { expanded: secs[0].querySelector('[data-testid="group-header"]').getAttribute('aria-expanded'), notes: secs[0].querySelectorAll('li').length },
           second: secs[1] ? { expanded: secs[1].querySelector('[data-testid="group-header"]').getAttribute('aria-expanded'), notes: secs[1].querySelectorAll('li').length } : null }; })()`);
console.log('折叠后读数:', JSON.stringify(afterFold));
const p2 = await shot('group-02-collapsed');

console.log(JSON.stringify({ shots: [p1, p2, p3] }));
cdp.close();
