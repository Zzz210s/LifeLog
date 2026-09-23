#!/usr/bin/env node
/**
 * T9 验收(续 2):B5 / B6 / C —— 都是 T6 复审交接里「真机仍缺」的项。
 *   B5 旧行已改名后点击 -> 错误条「标签「X」已变更,请重新选择」而非空筛选(版本 +1 后、候选池新数据落地前点)
 *   B6 浮层开着侧栏改名 -> 列表不闪空 / 高亮不丢 / scrollTop 不重置
 *   C  MRU 正常退出落盘(接受一条命令后托盘退出 -> ui.mru.commands 落库)
 * 用法:`node scripts/dev-palette-accept-tags.mjs`(跑完 C 会把应用退掉,需外部再拉起)。
 */
import { execFileSync } from 'node:child_process';
import { ensureMain, recorder, sleep, waitFor } from './cdp-lib.mjs';
import { os } from './cdp-os.mjs';
import { helpers, KEYS } from './palette-accept-lib.mjs';

const { record, finish } = recorder();
const { cdp: main } = await ensureMain();
const h = helpers(main);
const pid = os.pidOf();
const FIX = 'T9验收';
const STAMP = Date.now().toString().slice(-6);
const DB = 'C:/Users/23652/AppData/Roaming/com.lifelog.app/lifelog.db';
const hits = (kw) => h.call('query_notes', { conditions: { keyword: kw, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null }, offset: 0 });
/** 应用已退出时只能直读库(只读连接) */
const dbSetting = (key) => {
  const py = `import sqlite3;c=sqlite3.connect("file:${DB}?mode=ro",uri=True);r=c.execute("SELECT value FROM settings WHERE key=?",("${key}",)).fetchone();print("<none>" if r is None else r[0])`;
  return execFileSync('python', ['-c', py], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }).trim();
};
const renameTo = async (leaf) => {
  for (const p of [`${FIX}/陈旧A`, `${FIX}/陈旧B`]) {
    const t = await h.tagByPath(p);
    if (t) { await h.call('rename_tag', { tagId: t.id, newName: leaf }); return t.id; }
  }
  return null;
};
/** 通知写(唯一出口):勾一下夹具笔记的复选框 -> note-writes.updateNote -> notifyTagsChanged -> 版本 +1 */
const bump = () => main.eval(`(() => { const b = document.querySelector('[data-note-body="${fx5.id}"] input[type=checkbox]'); if (!b) return 'no-box'; b.click(); return 'clicked'; })()`);
const resetFilters = async () => {
  const chips = await h.chips();
  if (chips.length > 0) { await h.clickText('清空条件'); await sleep(600); }
};

// ---- 起点归一:tabs_state 写回「单标签页 + 空条件」再重载(上一轮可能把筛选落进了 tabs_state) ----
const EMPTY_TABS = '{"tabs":[{"title":"","conditions":{"keyword":null,"tags":[],"excludeTags":[],"tagPresence":null,"sort":"newest","expr":null}}],"activeIndex":0}';
await h.call('set_setting', { key: 'tabs_state', value: EMPTY_TABS });
await main.send('Page.reload');
await sleep(3000);
const ready = await waitFor(() => main.eval(`document.querySelectorAll('[data-note-body]').length > 0`).catch(() => false), 20, 300);
record('起点归一:重载后回到第 1 页(卡片数 50 / 无筛选)',
  ready === true && (await h.liCount()) === 50, `卡片=${await h.liCount()} chips=${JSON.stringify(await h.chips())}`);

// ---- B5 ----
const fx5 = await h.call('save_input_note', { content: `T9验收夹具-B5-${STAMP}\n\n- [ ] 事项\n#${FIX}/陈旧A` });
await sleep(1400);
let b5ok = false, b5detail = '';
const b5log = [];
for (const delay of [15, 20, 25, 30, 35, 40, 45, 55, 65, 80, 100, 130]) {
  await resetFilters();
  await renameTo('陈旧A');
  await bump();
  await sleep(700);
  await h.palette('quick'); await h.type(`#${FIX}/陈旧A`);
  await sleep(800);
  const hasRow = (await h.state()).rows.some((r) => r.id === `${FIX}/陈旧A`);
  await renameTo('陈旧B'); // 库里已改名(不通知):浮层行与候选池仍是旧数据
  const sched = await main.eval(`(() => {
    const row = document.querySelector('[data-row-id="${FIX}/陈旧A"]');
    const box = document.querySelector('[data-note-body="${fx5.id}"] input[type=checkbox]');
    if (!row || !box) return 'missing(row=' + !!row + ',box=' + !!box + ')';
    box.click();
    const t0 = performance.now();
    setTimeout(() => { row.click(); window.__t9b5 = Math.round(performance.now() - t0); }, ${delay});
    return 'scheduled';
  })()`);
  await sleep(1000);
  const errs = await h.alerts();
  const chips = await h.chips();
  const at = await main.eval(`window.__t9b5 ?? null`);
  const kind = errs.some((e) => e.includes('已变更')) ? '错误条' : chips.some((c) => c.includes('陈旧')) ? '空筛选' : '无动作';
  b5log.push(`${delay}ms:${kind}@${at}`);
  b5detail = `旧行在场=${hasRow} 排程=${sched} 逐次读数=${b5log.join(' ')} 末次错误条=${JSON.stringify(errs)}`;
  await h.esc();
  if (kind === '错误条') { b5ok = true; break; }
  await resetFilters();
}
record('B5 旧行已改名后点击 -> 错误条「标签「X」已变更」而非空筛选', b5ok, b5detail);
await resetFilters();

// ---- B6 浮层开着侧栏改名 ----
const B6TAG = `${FIX}改名${STAMP}`;
const fx6 = await h.call('save_input_note', { content: `T9验收夹具-B6-${STAMP}\n\n#${B6TAG}` });
await sleep(1600);
await h.palette('quick'); await h.type('#');
await sleep(900);
const b6before = await main.eval(`(() => { const root = document.querySelector('[data-floating="palette"]');
  const ul = root.querySelector('ul[role="listbox"]'); ul.scrollTop = 150;
  return { rows: ul.querySelectorAll('li[role="option"][data-row-id]').length, top: Math.round(ul.scrollTop) }; })()`);
for (let i = 0; i < 5; i++) await h.press(KEYS.down, 0, 20);
await sleep(300);
const selBefore = await main.eval(`document.querySelector('[data-floating="palette"] li[aria-selected="true"]')?.getAttribute('data-row-id')`);
await main.eval(`(() => {
  window.__t9b6 = [];
  const tick = () => { const root = document.querySelector('[data-floating="palette"]'); if (!root) return;
    const ul = root.querySelector('ul[role="listbox"]');
    window.__t9b6.push([ul.querySelectorAll('li[role="option"][data-row-id]').length,
      root.textContent.includes('无匹配结果') ? 1 : 0, Math.round(ul.scrollTop),
      ul.querySelectorAll('li[aria-selected="true"]').length]); };
  window.__t9b6t = setInterval(tick, 15); tick(); return true; })()`);
// 侧栏改名(真 UI:右键行 -> 重命名 -> 输入新名 -> Enter),onDone -> onTagsMutated -> 唯一出口通知 -> 版本 +1
const sideInfo = await main.eval(`JSON.stringify({ aside: !!document.querySelector('aside[data-testid="sidebar"]'), rows: Array.from(document.querySelectorAll('[data-tag-path]')).map((e) => e.getAttribute('data-tag-path')).filter((p) => p.startsWith('T9验收')) })`);
const rowAt = await main.eval(`(() => { const el = document.querySelector('[data-tag-path="${B6TAG}"]');
  if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + 40), y: Math.round(r.top + r.height / 2) }; })()`);
const renamed = await main.eval(`(() => { const el = document.querySelector('[data-tag-path="${B6TAG}"]');
  if (!el) return 'no-row'; const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 40, clientY: r.top + r.height / 2 }));
  return 'menu'; })()`);
await sleep(400);
const menuClick = await main.eval(`(() => { const b = Array.from(document.querySelectorAll('[data-tag-menu] button')).find((x) => x.textContent.trim() === '重命名');
  if (!b) return 'no-btn'; b.click(); return 'clicked'; })()`);
await sleep(300);
const typed = await main.eval(`(() => { const el = document.querySelector('input[aria-label="新标签名"]'); if (!el) return 'no-input';
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(el, '${B6TAG}后'); el.dispatchEvent(new Event('input', { bubbles: true })); return el.value; })()`);
await h.press(KEYS.enter);
await sleep(1500);
const samples = await main.eval(`(() => { clearInterval(window.__t9b6t); return window.__t9b6; })()`);
const emptySamples = samples.filter((s) => s[0] === 0 || s[1] === 1).length;
const selLost = samples.filter((s) => s[3] !== 1).length;
const tops = [...new Set(samples.map((s) => s[2]))];
const b6after = await h.state();
record('B6 浮层开着侧栏改名 -> 不闪空 / 高亮不丢 / scrollTop 不重置',
  renamed === 'menu' && menuClick === 'clicked' && typed === `${B6TAG}后` && b6before.rows > 10 && emptySamples === 0 && selLost === 0 &&
  tops.length === 1 && tops[0] === b6before.top && b6after.open === true && b6after.rows.length > 10,
  `侧栏=${sideInfo} 触发=${renamed}/${menuClick} 输入=${typed} 采样=${samples.length} 空列表样本=${emptySamples} 无高亮样本=${selLost} scrollTop 取值=${JSON.stringify(tops)}(期望 ${b6before.top}) 选中(前)=${selBefore} 改名后行数=${b6after.rows.length} 浮层开=${b6after.open}`);
await h.esc();

// ---- C MRU 落盘:三条路径分开读数(空闲 / beforeunload / 退出) ----
const mruOf = (s, id) => (JSON.parse(s === '' || s === '<none>' ? '[]' : s).find((e) => e.id === id)?.count ?? 0);
const acceptCmd = async (query, want) => {
  for (let i = 0; i < 3; i++) {
    await h.palette('palette'); await h.type(query);
    const s = await h.state();
    if (s.open && s.badge === '命令' && s.rows[0]?.id === want) { await h.press(KEYS.enter, 0, 30); return true; }
    await h.esc(); await sleep(400);
  }
  return false;
};
// C1:浮层「退出」命令(带 confirm):确认框是**原生** #32770 窗口(CDP 的 Page.javascriptDialogOpening 看不到),未确认前不退
await h.palette('palette'); await h.type('退出');
const c1rows = (await h.state()).rows.map((r) => r.id);
await h.press(KEYS.enter);
await sleep(1200);
const dlg = (await os.wins(pid)).find((w) => w.cls === '#32770' && w.visible);
const c1alive = !!(await h.call('get_setting', { key: 'theme' }).then(() => true).catch(() => false));
if (dlg) os.closeWindow(pid, dlg.title); // WM_CLOSE = 取消确认框,别把模态框留在屏幕上
await sleep(800);
const dlgAfter = (await os.wins(pid)).find((w) => w.cls === '#32770' && w.visible);
record('C1 浮层「退出」命令:弹出原生确认框(未确认不退;取消后应用仍可用)',
  c1rows[0] === 'app.quit' && dlg !== undefined && c1alive === true && dlgAfter === undefined,
  `首项=${JSON.stringify(c1rows)} 原生确认框=${dlg ? `${dlg.cls}|${dlg.title}` : '无'} 未确认时应用仍在=${c1alive} 取消后确认框仍在=${dlgAfter !== undefined} 仍可用=${await h.call('get_setting', { key: 'theme' }).then(() => true).catch(() => false)}`);
// C3:空闲路径(接受后等过 1.5s 空闲窗口)
const preC3 = dbSetting('ui.mru.commands');
const okC3 = await acceptCmd('新建笔记', 'note.new');
await sleep(2600);
const postC3 = dbSetting('ui.mru.commands');
record('C3 MRU 空闲落盘:接受后等过 1.5s 空闲窗口 -> 库里有该 id(计数 +1)',
  okC3 === true && mruOf(postC3, 'note.new') === mruOf(preC3, 'note.new') + 1,
  `接受成功=${okC3} 前=${mruOf(preC3, 'note.new')} 后=${mruOf(postC3, 'note.new')}`);
// C4:beforeunload 路径(接受后立刻重载,不等空闲窗口)
const preC4 = dbSetting('ui.mru.commands');
const okC4 = await acceptCmd('切换主题', 'theme.cycle');
await main.send('Page.reload');
await sleep(2600);
const postC4 = dbSetting('ui.mru.commands');
record('C4 MRU beforeunload/卸载落盘:接受后立刻重载(未等空闲窗口)-> 库里有该 id(计数 +1)',
  okC4 === true && mruOf(postC4, 'theme.cycle') === mruOf(preC4, 'theme.cycle') + 1,
  `接受成功=${okC4} 前=${mruOf(preC4, 'theme.cycle')} 后=${mruOf(postC4, 'theme.cycle')}`);
// C2:退出路径(接受 -> 距退出 < 空闲窗口 -> quit_app,与托盘「退出」同一条 Rust 路径)
const pre = dbSetting('ui.mru.commands');
const okC2 = await acceptCmd('打开设置', 'settings.open');
const mid = (await h.call('get_setting', { key: 'ui.mru.commands' })) ?? '';
const t0 = Date.now();
void h.call('quit_app').catch(() => {});
const dt = Date.now() - t0;
let gone = false;
for (let i = 0; i < 25 && !gone; i++) { await sleep(300); gone = !os.pidOf(); }
await sleep(600);
const post = dbSetting('ui.mru.commands');
record('C2 MRU 退出落盘:接受后立刻读库(未落盘,距退出 < 空闲窗口 1500ms)-> 退出 -> 库里有该 id(计数 +1)',
  okC2 === true && mid === pre && mruOf(post, 'settings.open') === mruOf(pre, 'settings.open') + 1 && dt < 1400 && gone === true,
  `接受成功=${okC2} 距退出=${dt}ms 退出完成=${gone} 前=${mruOf(pre, 'settings.open')} 接受后立刻读=${JSON.stringify(mid === pre ? '未落盘' : mid)} 后=${mruOf(post, 'settings.open')}`);

finish();
process.exit(process.exitCode ?? 0);
