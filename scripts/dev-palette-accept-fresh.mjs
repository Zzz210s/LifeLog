#!/usr/bin/env node
/**
 * T9 验收(续):A5 重启持久化复核 + B 组标签新鲜度(B1-B4)+ D 组(T8 交接)。
 * 前置:先跑 `dev-palette-accept.mjs`(留下 `main_quick_open_hotkey=ctrl+alt+k`),再重启应用。
 *   S0 重启后新键仍生效 / 旧键仍失效 / 清除后回默认
 *   B1 卸载兜底保存后 `#` 立即可见(编辑态被筛选变化卸载 -> use-save-on-unmount 写库)
 *   B2 翻页 + 编辑态下输入栏保存 -> `#` 搜到 + 列表不弹回首页 + 编辑面板不卸载
 *   B3 一次保存的 `list_tags` 计数(浮层关 = 1 / 浮层停在 `#` = 2;用 resource timing 计 IPC)
 *   B4 `#` 连输 10 字符 `list_tags` 恒 1 次(候选池按数据版本缓存)
 *   D1 乱序回包:空前缀(笔记 provider 4 次分页 IPC 在飞)时切到 `>`,最终列表仍是命令
 *   D2 `#` 补全三档顺序:固定项 -> 最近用过 -> 全量(按路径序)
 * 用法:`node scripts/dev-palette-accept-fresh.mjs`;夹具 `T9验收/*` 结束前删净。
 */
import { ensureMain, open, recorder, sleep, waitFor } from './cdp-lib.mjs';
import { os } from './cdp-os.mjs';
import { helpers, KEYS, CTRL, CTRL_SHIFT } from './palette-accept-lib.mjs';

const { record, finish } = recorder();
const { cdp: main } = await ensureMain();
const h = helpers(main);
const pid = os.pidOf();
const FIX = 'T9验收';
const STAMP = Date.now().toString().slice(-6);
const hits = (kw) => h.call('query_notes', { conditions: { keyword: kw, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null }, offset: 0 });
const setSetting = (key, value) => h.call('set_setting', { key, value });
const delSetting = (key) => setSetting(key, ''); // 空串 = 读取侧回退默认(见 palette-settings 消毒)
const refreshHotkeys = () => main.eval(`(() => { window.dispatchEvent(new Event('lifelog://app-hotkeys-changed')); return true; })()`);
/** IPC 计数:自定义协议 IPC 走 fetch,resource timing 里是 http://ipc.localhost/<cmd> */
const ipcMark = () => main.eval(`(() => { performance.setResourceTimingBufferSize(10000); window.__t9ipc = performance.getEntriesByType('resource').length; return window.__t9ipc; })()`);
const ipcSince = (name) => main.eval(`performance.getEntriesByType('resource').slice(window.__t9ipc).filter((e) => e.name.endsWith('/${name}')).length`);
const openInput = async () => {
  // 不无条件 show:show() 会抢 OS 焦点 -> 主窗 blur -> 编辑态被「失焦即保存」收掉(B2 要考的是 note-created 路径)
  if (!(await os.winVisible(pid, '拾枝'))) { await h.call('show_input_bar'); await sleep(700); }
  const conn = await waitFor(() => open('input').catch(() => null), 12, 250);
  return conn ? { conn, ih: helpers(conn.cdp) } : null;
};

// ---- 归一化起点:tabs_state 写回「单标签页 + 空条件」再重载(上一轮可能把筛选/分页留在会话里) ----
const EMPTY_TABS = '{"tabs":[{"title":"","conditions":{"keyword":null,"tags":[],"excludeTags":[],"tagPresence":null,"sort":"newest","expr":null}}],"activeIndex":0}';
await h.call('set_setting', { key: 'tabs_state', value: EMPTY_TABS });
await main.send('Page.reload');
await sleep(3000);
const ready = await waitFor(() => main.eval(`document.querySelectorAll('[data-note-body]').length > 0`).catch(() => false), 20, 300);
record('起点归一:主窗重载后回到第 1 页(卡片数 50 / 无筛选)',
  ready === true && (await h.liCount()) === 50 && (await h.chips()).length === 0,
  `卡片=${await h.liCount()} chips=${JSON.stringify(await h.chips())}`);

// ---- S0 重启持久化(A5 复核) ----
const stored0 = await h.call('get_setting', { key: 'main_quick_open_hotkey' });
await h.press(KEYS.k, 3);
const s0a = await h.state();
await h.esc();
await h.press(KEYS.p, CTRL);
const s0b = await h.state();
record('S0 重启后:自定义键 Ctrl+Alt+K 仍生效、旧键 Ctrl+P 仍失效、库值不变',
  stored0 === 'ctrl+alt+k' && s0a.open === true && s0b.open === false,
  `库值=${JSON.stringify(stored0)} 新键打开=${s0a.open} 旧键打开=${s0b.open}`);
// 清除 -> 回默认
await h.clickSel('button[aria-label="设置"]');
await sleep(700);
await h.clickText('清除');
await sleep(600);
const cleared = await h.call('get_setting', { key: 'main_quick_open_hotkey' });
await h.clickText('返回信息流');
await sleep(500);
await refreshHotkeys();
await sleep(300);
await h.press(KEYS.p, CTRL);
const s0c = await h.state();
await h.esc();
record('S0b 清除自定义键:库值空串、默认键 Ctrl+P 恢复生效',
  cleared === '' && s0c.open === true, `库值=${JSON.stringify(cleared)} Ctrl+P 打开=${s0c.open}`);

// ---- B1 卸载兜底保存后 `#` 立即可见 ----
const fx1 = await h.call('save_input_note', { content: `T9验收夹具-B1-${STAMP}` });
await sleep(900);
await h.clickSel(`[data-note-body="${fx1.id}"]`);
const b1panel = await main.eval(`!!document.querySelector('[data-testid="edit-panel"] textarea')`);
await h.type(`\n#${FIX}/卸载兜底`);
const tagBefore = await h.tagByPath(`${FIX}/卸载兜底`);
// 触发编辑面板卸载:接受一个真实标签 -> 条件变化 -> editingId 清空 -> 面板卸载(use-save-on-unmount 写库)
await h.palette('quick'); await h.type('#信息/工作'); await h.press(KEYS.enter);
await sleep(1200);
const panelGone = await main.eval(`!document.querySelector('[data-testid="edit-panel"]')`);
const tagAfter = await h.tagByPath(`${FIX}/卸载兜底`);
await h.palette('quick'); await h.type(`#${FIX}/卸载兜底`);
const b1 = await h.state();
record('B1 卸载兜底保存后 `#` 立即可见',
  b1panel === true && panelGone === true && tagBefore === null && tagAfter !== null &&
  b1.rows.some((r) => r.id === `${FIX}/卸载兜底`),
  `面板在场=${b1panel} 已卸载=${panelGone} 标签(前)=${tagBefore === null} 标签(后)=${tagAfter !== null} 浮层候选=${JSON.stringify(b1.rows.map((r) => r.id))}`);
await h.esc();
await h.palette('quick'); await h.type('#信息/工作'); await h.press(KEYS.enter); await sleep(500); // 还原筛选

// ---- B2 翻页 + 编辑态下输入栏保存 ----
await h.setScrollTop(99999);
const paged = await waitFor(async () => ((await h.liCount()) > 60 ? h.liCount() : null), 20, 400);
await h.setScrollTop(0);
await h.clickSel(`[data-note-body="${fx1.id}"]`);
const b2panel = await main.eval(`!!document.querySelector('[data-testid="edit-panel"]')`);
const inp = await openInput();
await inp.ih.setInputText(`T9验收夹具-B2-${STAMP} #${FIX}/翻页`);
await inp.ih.press(KEYS.enter, CTRL);
await sleep(1400);
const afterCount = await h.liCount();
const panelStill = await main.eval(`!!document.querySelector('[data-testid="edit-panel"]')`);
await h.palette('quick'); await h.type(`#${FIX}/翻页`);
const b2 = await h.state();
record('B2 翻页 + 编辑态下输入栏保存 -> `#` 搜到 + 列表不弹回首页 + 编辑面板不卸载',
  paged > 60 && b2panel === true && panelStill === true && afterCount >= paged - 1 &&
  b2.rows.some((r) => r.id === `${FIX}/翻页`) && (await hits(STAMP)).length === 2,
  `翻页渲染=${paged} 面板在场=${b2panel}/${panelStill} 保存后渲染=${afterCount} 浮层候选=${JSON.stringify(b2.rows.map((r) => r.id))} 库命中=${JSON.stringify((await hits(STAMP)).map((n) => n.id))}`);
await h.esc();

// ---- B3 一次保存的 list_tags 计数 ----
await h.palette('palette'); await h.esc(); // 确认浮层关闭
await ipcMark();
await inp.ih.setInputText(`T9验收夹具-B3-${STAMP} #${FIX}/计数`);
await inp.ih.press(KEYS.enter, CTRL);
await sleep(1600);
const closedCount = await ipcSince('list_tags');
await h.palette('quick'); await h.type('#');
await sleep(800);
await ipcMark();
await inp.ih.setInputText(`T9验收夹具-B4-${STAMP} #${FIX}/计数2`);
await inp.ih.press(KEYS.enter, CTRL);
await sleep(1600);
const openCount = await ipcSince('list_tags');
await h.esc();
record('B3 一次保存的 `list_tags` 计数:浮层关 = 1;浮层停在 `#` = 2(主窗重载 1 + 候选池 1)',
  closedCount === 1 && openCount === 2,
  `浮层关=${closedCount} 浮层停在 #=${openCount}(T6-fix2 复审口径)`);

// ---- B4 `#` 连输 10 字符 list_tags 恒 1 ----
// 先建一条夹具(经 note-created 出口把标签数据版本 +1),否则 `#` 候选池命中上一次的缓存,读不到取回
const fx4 = await h.call('save_input_note', { content: `T9验收夹具-B4-${STAMP}\n\n#${FIX}/计数` });
await sleep(1400);
await ipcMark();
await h.palette('quick'); await h.type('#');
await sleep(900);
const openCount1 = await ipcSince('list_tags');
for (const ch of `${FIX}/计数`) await h.type(ch);
const typedCount = await ipcSince('list_tags');
const rows10 = (await h.state()).rows.length;
await h.esc();
record('B4 `#` 连输 10 字符 `list_tags` 恒 1 次(候选池按数据版本缓存)',
  openCount1 === 1 && typedCount === 1 && rows10 > 0,
  `版本 +1 后打开时 list_tags=${openCount1} 10 次按键后累计=${typedCount} 候选行=${rows10} 夹具=${fx4.id}`);

// ---- D1 乱序回包:慢的第一次(笔记 provider)不得覆盖第二次(`>` 命令) ----
// Ctrl+P = 空前缀(笔记 provider,4 次分页 IPC);命令面板那个键本身就带 `>` 前缀,不能用来造重叠
await h.palette('palette'); await h.esc();
await main.eval(`(() => { performance.setResourceTimingBufferSize(10000); return true; })()`);
const tType = await main.eval(`performance.now()`);
await h.press(KEYS.p, CTRL, 70);
await h.type('>');
await sleep(1200);
const d1 = await h.state();
const late = await main.eval(`performance.getEntriesByType('resource').filter((e) => e.name.endsWith('/query_notes')).map((e) => Math.round(e.responseEnd)).filter((t) => t > ${tType}).length`);
const noteRows = d1.rows.filter((r) => /^\d+$/.test(r.id)).length;
await h.esc();
record('D1 乱序回包:空前缀(笔记 provider 4 次分页 IPC 在飞)时切 `>`,最终列表仍是命令',
  d1.badge === '命令' && d1.rows.length === 9 && noteRows === 0 && late > 0,
  `切前缀后仍在飞的 query_notes 回包=${late} badge=${d1.badge} 行数=${d1.rows.length} 笔记行=${noteRows}`);
// ---- D2 `#` 补全三档顺序 ----
await setSetting('ui.pinned.tags', JSON.stringify([`${FIX}/项目A`]));
await setSetting('ui.mru.tags', JSON.stringify([{ id: `${FIX}/夹具`, count: 2 }]));
const fx2 = await h.call('save_input_note', { content: `T9验收夹具-D2-${STAMP}\n\n#${FIX}/夹具 #${FIX}/项目A` });
await sleep(900);
await main.eval(`true`);
await inp.conn.cdp.send('Page.reload');
await sleep(1500);
await inp.ih.setInputText('#');
await sleep(900);
const d2 = await inp.ih.suggest();
const tail = d2.rows.slice(2, 6).map((r) => r.path);
await inp.ih.setInputText('');
await delSetting('ui.pinned.tags');
await delSetting('ui.mru.tags');
record('D2 `#` 补全三档顺序:固定项 -> 最近用过 -> 全量(按路径序)',
  d2.rows[0]?.path === `${FIX}/项目A` && d2.rows[0].pinned === true &&
  d2.rows[1]?.path === `${FIX}/夹具` && d2.rows[1].pinned === false && tail.includes('T9验收'),
  `顺序=${JSON.stringify(d2.rows.map((r) => r.path + (r.pinned ? '(固定)' : '')))} 夹具笔记=${fx2.id}`);

// ---- 收尾:删净夹具(含输入栏保存出来的那几条;按标记 + 夹具前缀双搜,防上一轮残留) ----
for (const kw of [STAMP, `${FIX}夹具`]) for (const n of await hits(kw)) await h.call('delete_note', { id: n.id });
for (const p of [`${FIX}/卸载兜底`, `${FIX}/翻页`, `${FIX}/计数`, `${FIX}/计数2`, `${FIX}/夹具`, `${FIX}/项目A`]) {
  const t = await h.tagByPath(p);
  if (t) await h.call('delete_tag', { tagId: t.id });
}
const left = (await h.call('list_tags')).filter((t) => t.path.startsWith(FIX)).map((t) => t.path);
record('收尾:夹具删净(笔记 0 / T9验收 标签 0)',
  left.length === 0 && (await hits(`${FIX}夹具`)).length === 0,
  `残留标签=${JSON.stringify(left)} 残留笔记=${(await hits(`${FIX}夹具`)).length} 告警=${JSON.stringify(await h.alerts())}`);

finish();
process.exit(process.exitCode ?? 0);
