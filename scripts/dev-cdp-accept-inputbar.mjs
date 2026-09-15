#!/usr/bin/env node
/**
 * 既有功能零回归(二):快捷输入栏(保存/Ctrl+Enter/Esc/双击隐藏/滚轮缩放/Ctrl+滚轮透明度/宽度拉伸)
 * 与窗口级读数(主窗标题、托盘与全局热键注册、热键切换显隐)。
 * 用法: node scripts/dev-cdp-accept-inputbar.mjs   (先以 9222 调试端口启动 pnpm tauri dev)
 * 可见性一律用 user32 IsWindowVisible 读数(CDP 的 visibilityState 对已隐藏窗口仍报 visible);
 * 输入栏的窗口尺寸变化从 Win32 矩形与设置键 input_w 两处取证。
 */
import { spawnSync } from 'node:child_process';
import { open, recorder, sleep, waitFor, bindMain } from './cdp-lib.mjs';
import { bindDom } from './cdp-dom.mjs';

const { record, finish } = recorder();
const sh = (cmd, args) =>
  spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
const PROBE = (cmd, extra) => JSON.parse(sh('python', ['scripts/win-probe.py', cmd, String(pid), ...(extra ? [extra] : [])]).stdout || '{}');
const pid = Number(sh('powershell', ['-NoProfile', '-Command', "(Get-Process | Where-Object { $_.ProcessName -match '^lifelog$' } | Select-Object -First 1).Id"]).stdout.trim());
const wins = () => PROBE('list').length !== undefined ? PROBE('list') : [];
const inputWin = () => wins().find((w) => w.cls === 'Tauri Window' && w.title === '输入栏');
const shown = () => !!inputWin()?.visible;
const hotkey = () => sh('python', ['scripts/win-probe.py', 'hotkey', 'ctrl+shift+q']);
const rectOf = () => (inputWin() || {}).rect;

const mainPage = await open('main');
const inputPage = await open('input');
const { call, inventory } = bindMain(mainPage.cdp);
const setSetting = (key, value) => call('set_setting', { key, value });
const getSetting = (key) => call('get_setting', { key });
const input = bindDom(inputPage.cdp);

const inv0 = await inventory();
const zoom0 = await getSetting('input_zoom');
const width0 = await getSetting('input_w');
const height0 = await getSetting('input_h');
console.log('验收前库存:', JSON.stringify({ notes: inv0.notes, views: inv0.views, tagPaths: inv0.paths.length }), `input_zoom=${zoom0} input_w=${width0}`);

// ---------- 窗口级:改名后的主窗标题 / 托盘与热键注册 / 热键切换显隐 ----------
const all = wins();
const mainWin = all.find((w) => w.cls === 'Tauri Window' && w.title === 'LifeLog');
record('W1 主窗标题为 LifeLog(Win32 读数)', !!mainWin, JSON.stringify(mainWin ? { title: mainWin.title, visible: mainWin.visible, rect: mainWin.rect } : null));
record(
  'W2 托盘与全局热键已注册(tray_icon_app / global_hotkey_app 窗口存在)',
  all.some((w) => w.cls === 'tray_icon_app') && all.some((w) => w.cls === 'global_hotkey_app'),
  JSON.stringify(all.map((w) => w.cls))
);
await call('show_input_bar');
const shownByCmd = await waitFor(async () => (shown() ? true : null));
hotkey();
const hiddenByKey = await waitFor(async () => (shown() ? null : true));
hotkey();
const shownByKey = await waitFor(async () => (shown() ? true : null));
record(
  'W3 全局热键 Ctrl+Shift+Q 切换输入栏显隐(真实按键 + IsWindowVisible)',
  shownByCmd === true && hiddenByKey === true && shownByKey === true,
  `IPC 显示=${shownByCmd} 热键隐藏=${hiddenByKey} 热键唤起=${shownByKey}`
);

// ---------- I1 输入栏保存(Ctrl+Enter) ----------
const TEST_NOTE = 'P5输入栏回归';
const typed = await input.evalIn(`(() => {
  const ta = document.querySelector('textarea[aria-label="输入栏内容"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, ${JSON.stringify(TEST_NOTE)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  return { typed: ta.value };
})()`);
const saved = await waitFor(async () =>
  (await call('query_notes', { conditions: { keyword: TEST_NOTE, tags: [], excludeTags: [], from: null, to: null, tagPresence: null, sort: 'newest' }, offset: 0 })).length === 1 && true
);
// 落库、清空与浮层都是异步落地的:轮询到「输入框已清空 + 出现保存浮层」再断言,避免读到中间态
const cleared = await waitFor(async () => {
  const v = await input.evalIn(`(() => ({ value: document.querySelector('textarea[aria-label="输入栏内容"]').value, stamp: document.body.innerText.trim().slice(0, 30) }))()`);
  return v.value === '' && v.stamp.includes('已保存') ? v : null;
});
record(
  'I1 输入栏 Ctrl+Enter 保存成功:落库 + 输入框清空 + 保存浮层',
  typed.typed === TEST_NOTE && saved === true && cleared !== null,
  `输入=${JSON.stringify(typed.typed)} 命中=${saved} 已清空=${cleared !== null} 浮层=${JSON.stringify(cleared && cleared.stamp)}`
);

// ---------- I2 Esc 隐藏 ----------
await call('show_input_bar');
await waitFor(async () => (shown() ? true : null));
await input.evalIn(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
const hiddenByEsc = await waitFor(async () => (shown() ? null : true));
record('I2 Esc 隐藏输入栏(OS 可见性读数)', hiddenByEsc === true, `可见=${shown()}`);

// ---------- I3 双击拖动带隐藏 ----------
await call('show_input_bar');
await waitFor(async () => (shown() ? true : null));
const dblDetail = await input.evalIn(`(() => {
  const root = document.querySelector('textarea[aria-label="输入栏内容"]').parentElement;
  const r = root.getBoundingClientRect();
  const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 2, clientX: r.left + r.width / 2, clientY: r.top + 2 });
  root.dispatchEvent(ev);
  return { clientY: ev.clientY - r.top, height: r.height };
})()`);
const hiddenByDbl = await waitFor(async () => (shown() ? null : true));
record('I3 拖动带内双击(mousedown detail=2)隐藏输入栏', hiddenByDbl === true, `双击点=${JSON.stringify(dblDetail)} 可见=${shown()}`);

// ---------- I4 普通滚轮缩放(OS 窗口尺寸 + input_zoom) ----------
await call('show_input_bar');
await waitFor(async () => (shown() ? true : null));
const beforeZoom = { zoom: await getSetting('input_zoom'), rect: rectOf() };
await input.evalIn(`window.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))`);
await sleep(1500);
const afterZoom = { zoom: await getSetting('input_zoom'), rect: rectOf() };
record(
  'I4 普通滚轮缩放生效(input_zoom 与 Win32 窗口尺寸同步变化)',
  afterZoom.zoom !== beforeZoom.zoom && afterZoom.rect[2] - afterZoom.rect[0] > beforeZoom.rect[2] - beforeZoom.rect[0],
  `zoom ${beforeZoom.zoom} -> ${afterZoom.zoom} 宽 ${beforeZoom.rect[2] - beforeZoom.rect[0]} -> ${afterZoom.rect[2] - afterZoom.rect[0]}`
);

// ---------- I5 Ctrl+滚轮调透明度 ----------
const opacityOf = () => input.evalIn(`document.querySelector('textarea[aria-label="输入栏内容"]').parentElement.style.opacity`);
const beforeOpacity = await opacityOf();
await input.evalIn(`window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true }))`);
await sleep(600);
const afterOpacity = await opacityOf();
record('I5 Ctrl+滚轮调整透明度(根节点 inline opacity 变小)', Number(afterOpacity) < Number(beforeOpacity), `opacity ${beforeOpacity} -> ${afterOpacity}`);

// ---------- I6 中键恢复(缩放 100% + 默认透明度) ----------
await input.evalIn(`(() => {
  const root = document.querySelector('textarea[aria-label="输入栏内容"]').parentElement;
  root.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1, detail: 1 }));
  return true;
})()`);
await input.evalIn(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
await call('show_input_bar');
await waitFor(async () => (shown() ? true : null));
await sleep(800);
const restored = { zoom: await getSetting('input_zoom'), opacity: await opacityOf() };
record('I6 中键恢复视图(缩放回到 1.00,透明度回默认)', restored.zoom === '1.00' && restored.opacity === '1', `zoom=${restored.zoom} opacity=${restored.opacity}`);

// ---------- I7 宽度拉伸(CDP 真实鼠标按下 + 移动 + 松开) ----------
const beforeDrag = { w: await getSetting('input_w'), rect: rectOf() };
const dragMouse = async (type, x, button) => {
  await inputPage.cdp.send('Input.dispatchMouseEvent', { type, x, y: 40, button: 'left', buttons: button, clickCount: 1 });
};
await dragMouse('mousePressed', 5, 1);
await sleep(300);
for (const x of [25, 45, 65]) await dragMouse('mouseMoved', x, 1);
await dragMouse('mouseReleased', 65, 0);
await sleep(1500);
const afterDrag = { w: await getSetting('input_w'), rect: rectOf() };
record(
  'I7 左边缘按住拖动改变窗口宽度(input_w 与 Win32 宽度同步变小)',
  Number(afterDrag.w) < Number(beforeDrag.w) && afterDrag.rect[2] - afterDrag.rect[0] < beforeDrag.rect[2] - beforeDrag.rect[0],
  `input_w ${beforeDrag.w} -> ${afterDrag.w} 宽 ${beforeDrag.rect[2] - beforeDrag.rect[0]} -> ${afterDrag.rect[2] - afterDrag.rect[0]}`
);

// ---------- 还原:删除测试笔记 + 窗口尺寸与缩放回到验收前 ----------
const ids = (await call('query_notes', { conditions: { keyword: TEST_NOTE, tags: [], excludeTags: [], from: null, to: null, tagPresence: null, sort: 'newest' }, offset: 0 })).map((n) => n.id);
for (const id of ids) await call('delete_note', { id });
// input_w/input_h 存的是「缩放=1 的基础物理尺寸」,set_input_size 的入参是**CSS 意图**;
// 还原必须先按 sf = dpr / zoom 把基础尺寸换算回意图,否则会写成 base*sf(实测 404 -> 505)
const dpr = await inputPage.cdp.eval('window.devicePixelRatio');
const zoomNow = Number(await getSetting('input_zoom'));
const sf = dpr / zoomNow;
const intent = (base) => Math.round((Number(base) * zoomNow) / sf);
await call('set_input_size', { width: intent(width0), height: intent(height0) });
await setSetting('input_zoom', zoom0);
await sleep(600);
await call('hide_input_bar');
const inv1 = await inventory();
record(
  'I8 库存前后一致(笔记 id 清单 / 标签路径 / 视图数)+ 窗口尺寸还原',
  inv1.notes === inv0.notes && inv1.views === inv0.views && JSON.stringify(inv1.paths) === JSON.stringify(inv0.paths) && (await getSetting('input_w')) === width0 && (await getSetting('input_h')) === height0,
  `notes ${inv1.notes}/${inv0.notes} views ${inv1.views}/${inv0.views} input_w ${await getSetting('input_w')}/${width0} input_h ${await getSetting('input_h')}/${height0} 宽 ${rectOf()[2] - rectOf()[0]}`
);

finish();
mainPage.close();
inputPage.close();
