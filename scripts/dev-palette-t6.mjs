#!/usr/bin/env node
/**
 * T6 端到端验收(不碰鼠标的 OS 级操作;真实键鼠走 CDP Input):
 *   1 命令面板:打开 -> 搜「导」-> 执行 -> 副作用可见(侧栏消失 / 勾选态换边)
 *   2 快速打开笔记:搜到 -> Enter -> 流中该卡片滚进视野并高亮
 *   3 `#` 标签:Enter -> 筛选 chips 增加(再 Enter 还原)
 *   4 编辑中执行命令:内容已落库(编辑面板因保存成功而退出)
 *   5 一次外部按下:pointerdown 时浮层仍开 -> mousedown 后已关,且内容已落库
 * 用法:以 9222 启动 `pnpm tauri dev` 后 `node scripts/dev-palette-t6.mjs`
 * 前置:先备份真实库(脚本会改设置表与一条笔记正文;验收后请还原库文件)。
 */
import { ensureMain, recorder, sleep } from './cdp-lib.mjs';

const { record, finish } = recorder();
const { cdp: main, close } = await ensureMain();
const MARK1 = 'T6落库标记甲';
const MARK2 = 'T6落库标记乙';

const KEYS = {
  p: { key: 'P', code: 'KeyP', vk: 80 },
  enter: { key: 'Enter', code: 'Enter', vk: 13 },
  esc: { key: 'Escape', code: 'Escape', vk: 27 },
};
const CTRL = 2;
const CTRL_SHIFT = 10;

const press = async (k, modifiers = 0) => {
  const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers };
  await main.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await main.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(280);
};
const type = async (text) => {
  await main.send('Input.insertText', { text });
  await sleep(420);
};
const openPalette = (kind) => press(KEYS.p, kind === 'palette' ? CTRL_SHIFT : CTRL);
const esc = () => press(KEYS.esc);
const enter = () => press(KEYS.enter);

const STATE = `(() => {
  const root = document.querySelector('[data-floating="palette"]');
  if (!root) return { present: false, open: false, badge: '', rows: [], query: '' };
  const rows = Array.from(root.querySelectorAll('li[role="option"]'))
    .map((li) => ({ id: li.getAttribute('data-row-id'), label: li.textContent.trim(),
      marks: li.querySelectorAll('mark').length, selected: li.getAttribute('aria-selected') === 'true' }))
    .filter((r) => r.id !== null);
  return { present: true, open: !root.hidden, badge: root.querySelector('span')?.textContent ?? '',
    rows, query: root.querySelector('input[role="combobox"]')?.value ?? '' };
})()`;
const state = () => main.eval(STATE);
const sidebarVisible = () => main.eval(`!!document.querySelector('aside[data-testid="sidebar"]')`);
const chips = () => main.eval(`Array.from(document.querySelectorAll('[aria-label="已生效的筛选条件"] span')).map((s) => s.textContent.trim())`);
const noteHits = (marker) => main.eval(`(async () => {
  const notes = await window.__TAURI_INTERNALS__.invoke('query_notes', {
    conditions: { keyword: ${JSON.stringify(marker)}, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null },
    offset: 0,
  });
  return notes.map((n) => n.id);
})()`);
const clickSelector = async (sel) => {
  const at = await main.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null; const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  if (!at) throw new Error(`找不到可点元素:${sel}`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await main.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
  }
  await sleep(450);
};

// ---- 场景 1:命令面板(打开 -> 搜「导」-> 执行 -> 副作用可见) ----
await openPalette('palette');
const s1 = await state();
record(
  '1a 打开命令面板:浮层可见、徽标=命令、列表 = when 为真的命令',
  s1.open === true && s1.badge === '命令' && s1.rows.length > 0,
  `open=${s1.open} badge=${s1.badge} 项数=${s1.rows.length}`
);
await type('导');
const s1b = await state();
record(
  '1b 搜「导」->「导出整库」排第一且含 <mark>',
  s1b.rows[0]?.id === 'export.all' && s1b.rows[0].marks > 0,
  `首项=${s1b.rows[0]?.id} 高亮段=${s1b.rows[0]?.marks} 行数=${s1b.rows.length}`
);
await esc();
await openPalette('palette');
await type('侧栏');
const before = await sidebarVisible();
await enter();
const hidden = await sidebarVisible();
record('1c 执行「隐藏侧栏」-> 侧栏消失', before === true && hidden === false, `执行前=${before} 执行后=${hidden}`);
await openPalette('palette');
await type('侧栏');
const s1d = await state();
record(
  '1d 重开该项显示勾选态换边(标题变「显示侧栏」)',
  s1d.rows[0]?.label === '显示侧栏',
  `首项标题=${s1d.rows[0]?.label}`
);
await enter(); // 还原侧栏
const restored = await sidebarVisible();
record('1e 再执行一次还原侧栏(验收前后一致)', restored === true, `侧栏可见=${restored}`);

// ---- 场景 2:快速打开笔记 ----
const first = await main.eval(`(() => { const el = document.querySelector('[data-note-body]');
  if (!el) return null; const id = Number(el.getAttribute('data-note-body'));
  const text = el.textContent.trim().replace(/\\s+/g, ' ');
  return { id, text, key: text.slice(0, Math.min(6, text.length)) }; })()`);
if (first === null) throw new Error('流里没有笔记卡片,无法验收快速打开');
await openPalette('quick');
await type(first.key);
const s2 = await state();
record(
  '2a 快速打开:输入笔记独特串 -> 该笔记排第一',
  s2.badge === '笔记' && s2.rows[0]?.id === String(first.id),
  `徽标=${s2.badge} 首项=${s2.rows[0]?.id} 期望=${first.id} 关键词=${first.key}`
);
await enter();
const s2b = await main.eval(`(() => { const el = document.querySelector('[data-note-body="${first.id}"]');
  if (!el) return null; const row = el.closest('li'); const r = row.getBoundingClientRect();
  const box = row.parentElement.parentElement.getBoundingClientRect();
  return { highlighted: row.className.includes('bg-accent-soft'), inView: r.top >= box.top - 1 && r.bottom <= box.bottom + 1, top: Math.round(r.top) }; })()`);
record(
  '2b Enter 后浮层关闭、该卡片滚进视野并高亮',
  (await state()).open === false && s2b?.highlighted === true && s2b?.inView === true,
  `open=${(await state()).open} 高亮=${s2b?.highlighted} 在视野内=${s2b?.inView} 卡片 top=${s2b?.top}`
);

// ---- 场景 3:`#` 标签 -> 筛选 chips 增加 ----
const tagPart = await main.eval(`(() => { const chip = document.querySelector('[aria-label="已生效的筛选条件"] span');
  const aside = document.querySelector('aside[data-testid="sidebar"]');
  const text = (aside ?? document.body).textContent ?? '';
  const m = text.match(/[^\\s#]+\\/[^\\s#]+/);
  return m ? m[0] : (chip ? chip.textContent.trim() : null); })()`);
const tagName = tagPart ?? '工作';
const chipsBefore = await chips();
await openPalette('quick');
await type('#' + tagName);
const s3 = await state();
await enter();
const chipsAfter = await chips();
record(
  '3 `#` 标签:前缀实时切到标签 -> Enter -> 筛选 chips 增加该标签',
  s3.badge === '标签' && chipsAfter.length === chipsBefore.length + 1 && chipsAfter.some((c) => c.includes(tagName)),
  `徽标=${s3.badge} 候选首项=${s3.rows[0]?.label} chips ${JSON.stringify(chipsBefore)} -> ${JSON.stringify(chipsAfter)}`
);
await openPalette('quick');
await type('#' + tagName);
await enter();
record('3b 再 Enter 同一标签还原筛选', (await chips()).length === chipsBefore.length, `chips=${JSON.stringify(await chips())}`);

// ---- 场景 4:编辑中执行命令 -> 内容已落库 ----
await clickSelector('[data-note-body="' + first.id + '"]');
const panelOpen = await main.eval(`!!document.querySelector('[data-testid="edit-panel"] textarea')`);
await type(MARK1);
const typed = await main.eval(`document.querySelector('[data-testid="edit-panel"] textarea')?.value.includes(${JSON.stringify(MARK1)})`);
const hitsBefore = await noteHits(MARK1);
await openPalette('palette');
await type('侧栏');
await enter();
const hitsAfter = await noteHits(MARK1);
const panelGone = await main.eval(`!document.querySelector('[data-testid="edit-panel"]')`);
record(
  '4 编辑中执行命令 -> 内容已落库(落库前 DOM 有、库无;落库后库命中且编辑面板因保存成功退出)',
  panelOpen === true && typed === true && hitsBefore.length === 0 && hitsAfter.length === 1 && panelGone === true,
  `面板在场=${panelOpen} DOM含标记=${typed} 库命中(前)=${JSON.stringify(hitsBefore)} 库命中(后)=${JSON.stringify(hitsAfter)} 面板已退出=${panelGone}`
);
await openPalette('palette');
await type('侧栏');
await enter(); // 还原侧栏

// ---- 场景 5:一次外部按下 = 先保存(浮层仍开)-> 后关浮层 ----
await clickSelector('[data-note-body="' + first.id + '"]');
await type(MARK2);
await openPalette('palette');
await main.eval(`(() => {
  window.__t6seq = [];
  const open = () => { const r = document.querySelector('[data-floating="palette"]'); return !!r && !r.hidden; };
  document.addEventListener('pointerdown', () => window.__t6seq.push('pointerdown:open=' + open()));
  window.addEventListener('mousedown', () => window.__t6seq.push('mousedown:open=' + open()));
  return true;
})()`);
await clickSelector('header');
const seq = await main.eval(`window.__t6seq`);
const s5open = (await state()).open;
const s5hits = await noteHits(MARK2);
record(
  '5 一次外部按下:pointerdown 触发保存时浮层仍开 -> mousedown 后已关,内容已落库',
  seq.length === 2 && seq[0] === 'pointerdown:open=true' && seq[1] === 'mousedown:open=false' && s5open === false && s5hits.length === 1,
  `序列=${JSON.stringify(seq)} 浮层open=${s5open} 库命中=${JSON.stringify(s5hits)}`
);

close();
finish();
