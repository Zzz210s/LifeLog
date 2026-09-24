#!/usr/bin/env node
/**
 * T9 A 组端到端验收(设计 §6.3 八场景;安装版 + 9222 CDP,**不碰物理鼠标**):
 *   A1 命令面板:打开 -> 项数 == when 为真的命令数 -> 输入「导」排第一且含 <mark>
 *   A2 执行命令:「隐藏侧栏」-> 侧栏消失 + 勾选态换边;「切换主题」-> 根 class 变化
 *   A3 快速打开:独特串 -> 排第一 -> Enter 关闭浮层且卡片滚进视野并高亮(滚动位置变化)
 *   A4 标签跳转:`#标签` -> Enter -> 筛选 chips 增加且结果数 == 该标签计数
 *   A5 快捷键自设:录成 Ctrl+Alt+K -> 新键生效、旧键失效、落库(重启持久化见 accept-fresh)
 *   A6 补全:`#项A` 分解读数(主窗浮层 / 输入栏)+ 输入栏前缀命中带高亮;Esc 只关列表
 *   A7 焦点归位:打开前焦点在 Composer -> Esc 后回 Composer;A8 编辑态保护:编辑中执行命令 -> 内容已落库
 * 用法:以 9222 启动安装版后 `node scripts/dev-palette-accept.mjs`;脚本建 `T9验收/*` 夹具,结束前删净。
 */
import { ensureMain, open, recorder, sleep, waitFor } from './cdp-lib.mjs';
import { os } from './cdp-os.mjs';
import { helpers, KEYS, CTRL, CTRL_SHIFT, CTRL_ALT } from './palette-accept-lib.mjs';

const { record, finish } = recorder();
const { cdp: main } = await ensureMain();
const h = helpers(main);
const pid = os.pidOf();
const FIX = 'T9验收';
const STAMP = Date.now().toString().slice(-6);
/** 应用内快捷键缓存刷新:直调 IPC 不会广播,验收脚本自己派发 T6/T7 约定的事件 */
const refreshHotkeys = () => main.eval(`(() => { window.dispatchEvent(new Event('lifelog://app-hotkeys-changed')); return true; })()`);
const hits = (kw) => h.call('query_notes', { conditions: { keyword: kw, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null }, offset: 0 });
// ---- 前置:两个应用内快捷键清回默认(上一轮验收可能留下自定义键) ----
const prev = [await h.call('get_setting', { key: 'main_quick_open_hotkey' }), await h.call('get_setting', { key: 'main_palette_hotkey' })];
if (prev[0]) await h.call('set_app_hotkey', { kind: 'quickOpen', accelerator: '' });
if (prev[1]) await h.call('set_app_hotkey', { kind: 'palette', accelerator: '' });
if (prev[0] || prev[1]) await refreshHotkeys();
// 起点归一:tabs_state 写回「单标签页 + 空条件」再重载(上一轮可能把筛选/分页留在会话里)
const EMPTY_TABS = '{"tabs":[{"title":"","conditions":{"keyword":null,"tags":[],"excludeTags":[],"tagPresence":null,"sort":"newest","expr":null}}],"activeIndex":0}';
await h.call('set_setting', { key: 'tabs_state', value: EMPTY_TABS });
await main.send('Page.reload');
await sleep(3000);
// ---- 夹具:一条带两个标签的笔记(结束前删净) ----
const fixture = await h.call('save_input_note', { content: `T9验收夹具-快速打开-${STAMP}\n\n#${FIX}/夹具 #${FIX}/项目A` });
const fixtureTag = await h.tagByPath(`${FIX}/夹具`);
record('前置+夹具:快捷键回默认;save_input_note -> 笔记 + 两个标签',
  fixture.id > 0 && fixtureTag !== null, `旧键值=${JSON.stringify(prev)} id=${fixture.id} 标签计数=${fixtureTag?.subtree_count}`);
// ---- A1 命令面板 ----
await h.palette('palette');
const s1 = await h.state();
const tabs = JSON.parse((await h.call('get_setting', { key: 'tabs_state' })) ?? '{"tabs":[1]}').tabs;
const expectCmds = tabs.length > 1 ? 11 : 9;
record('A1a 打开命令面板:浮层可见、徽标=命令、项数 == when 为真的命令数',
  s1.open === true && s1.badge === '命令' && s1.rows.length === expectCmds,
  `open=${s1.open} badge=${s1.badge} 项数=${s1.rows.length} 期望=${expectCmds}(标签页 ${tabs.length})`);
await h.type('导');
const s1b = await h.state();
record('A1b 输入「导」->「导出整库」排第一且含 <mark>',
  s1b.rows[0]?.id === 'export.all' && s1b.rows[0].marks > 0,
  `首项=${s1b.rows[0]?.id} 高亮段=${s1b.rows[0]?.marks} 行数=${s1b.rows.length}`);
await h.esc();

// ---- A2 执行命令 ----
const sbBefore = await h.sidebar();
await h.palette('palette'); await h.type('侧栏'); await h.press(KEYS.enter);
const sbAfter = await h.sidebar();
await h.palette('palette'); await h.type('侧栏');
const s2 = await h.state();
record('A2a 执行「隐藏侧栏」-> 侧栏消失;再开浮层该项显示勾选态换边',
  sbBefore === true && sbAfter === false && s2.rows[0]?.label === '显示侧栏',
  `侧栏 ${sbBefore} -> ${sbAfter} 首项标题=${s2.rows[0]?.label}`);
await h.press(KEYS.enter);
record('A2a2 再执行一次还原侧栏', (await h.sidebar()) === true, `侧栏可见=${await h.sidebar()}`);
const cls = () => main.eval(`document.documentElement.className`);
const clsBefore = await cls();
let clsAfter = clsBefore, tries = 0;
while (tries < 3 && clsAfter === clsBefore) {
  tries++;
  await h.palette('palette'); await h.type('切换主题'); await h.press(KEYS.enter);
  clsAfter = await cls();
}
record('A2b 执行「切换主题」-> documentElement.classList 变化',
  clsAfter !== clsBefore, `class ${JSON.stringify(clsBefore)} -> ${JSON.stringify(clsAfter)}(执行 ${tries} 次)`);
await h.call('set_setting', { key: 'theme', value: 'system' });

// ---- A3 快速打开笔记 ----
await h.setScrollTop(600);
await sleep(300);
const scBefore = await h.scrollTop();
await h.palette('quick'); await h.type(`T9验收夹具-快速打开-${STAMP}`);
const s3 = await h.state();
await h.press(KEYS.enter);
const s3b = await main.eval(`(() => { const el = document.querySelector('[data-note-body="${fixture.id}"]');
  if (!el) return null; const row = el.closest('li'); const sc = document.querySelector('[data-note-body]')?.closest('.scroll-gutter');
  const r = row.getBoundingClientRect(), b = sc.getBoundingClientRect();
  return { highlighted: row.className.includes('bg-accent-soft'),
    inView: r.top >= b.top - 1 && r.bottom <= b.bottom + 1, top: Math.round(sc.scrollTop) }; })()`);
record('A3 快速打开:独特串排第一 -> Enter 关闭浮层 + 卡片滚进视野并高亮(滚动位置变化)',
  s3.badge === '笔记' && s3.rows[0]?.id === String(fixture.id) && (await h.state()).open === false &&
  s3b?.highlighted === true && s3b?.inView === true && s3b?.top < scBefore,
  `badge=${s3.badge} 首项=${s3.rows[0]?.id} 期望=${fixture.id} open=${(await h.state()).open} 高亮=${s3b?.highlighted} 在视野=${s3b?.inView} scrollTop ${scBefore} -> ${s3b?.top}`);

// ---- A4 标签跳转 ----
const chipsBefore = await h.chips();
await h.palette('quick'); await h.type(`#${FIX}/夹具`);
const s4 = await h.state();
await h.press(KEYS.enter);
await sleep(400);
const chipsAfter = await h.chips();
const shown = await h.liCount();
record('A4 `#` 标签:Enter -> 筛选 chips 增加该标签,结果数与该标签计数一致',
  s4.badge === '标签' && s4.rows[0]?.id === `${FIX}/夹具` &&
  chipsAfter.length === chipsBefore.length + 1 && shown === fixtureTag?.subtree_count,
  `徽标=${s4.badge} 首项=${s4.rows[0]?.id} chips ${JSON.stringify(chipsBefore)} -> ${JSON.stringify(chipsAfter)} 渲染=${shown} 标签计数=${fixtureTag?.subtree_count}`);
await h.palette('quick'); await h.type(`#${FIX}/夹具`); await h.press(KEYS.enter); await sleep(400);
record('A4b 再 Enter 同一标签还原筛选', (await h.chips()).length === chipsBefore.length, `chips=${JSON.stringify(await h.chips())}`);

// ---- A6 标签补全(主窗浮层 + 输入栏;`#项A` 是设计 §6.3 的原始例子) ----
await h.palette('quick'); await h.type('#项A');
const s6p = await h.state();
record('A6d 主窗浮层 `#项A` -> 夹具标签「T9验收/项目A」在候选内且含高亮(共享打分引擎)',
  s6p.badge === '标签' && s6p.rows.some((r) => r.id === `${FIX}/项目A` && r.marks > 0),
  `候选=${JSON.stringify(s6p.rows.map((r) => r.id + '#' + r.marks))}`);
await h.esc();
await h.call('show_input_bar');
await sleep(700);
const inputConn = await waitFor(() => open('input').catch(() => null), 12, 250);
if (inputConn) {
  const ih = helpers(inputConn.cdp);
  await ih.setInputText('#项A');
  await sleep(600);
  const sug = await ih.suggest();
  const hitA = sug.rows.find((r) => r.path === `${FIX}/项目A`);
  record('A6a 输入栏 `#项A`:设计 §6.3 期望「…/项目A」在候选内且含高亮',
    hitA !== undefined && hitA.marks > 0,
    `候选=${JSON.stringify(sug.rows.map((r) => r.path + '#' + r.marks))} 目标项=${JSON.stringify(hitA ?? null)}(候选池 = 前缀 + 子串/子序列)`);
  await ih.setInputText(`#${FIX}/项`);
  await sleep(600);
  const sug2 = await ih.suggest();
  const hitB = sug2.rows.find((r) => r.path === `${FIX}/项目A`);
  record('A6b 输入栏前缀命中带高亮(标签档的段来自打分器)', sug2.open && hitB !== undefined && hitB.marks > 0,
    `候选=${JSON.stringify(sug2.rows.map((r) => r.path + '#' + r.marks))}`);
  await ih.press(KEYS.esc);
  await sleep(500);
  const afterEsc = await inputConn.cdp.eval(`({ suggest: !!document.querySelector('[data-testid="tag-suggest"]'), vis: document.visibilityState })`);
  record('A6c 输入栏 Esc:只关候选列表,不隐藏窗口',
    afterEsc.suggest === false && afterEsc.vis === 'visible' && (await os.winVisible(pid, '拾枝')) === true,
    `列表在场=${afterEsc.suggest} visibilityState=${afterEsc.vis} 窗口可见=${await os.winVisible(pid, '拾枝')}`);
  await ih.setInputText('');
} else {
  record('A6a/A6b/A6c 输入栏补全', false, '连不上 input 页面');
}

// ---- A7 焦点归位 ----(输入框已换成统一输入框:选择器与 aria-label 同步改)
await main.eval(`document.querySelector('[data-testid="unified-input"]').focus()`);
const focusBefore = await main.eval(`document.activeElement?.getAttribute('aria-label')`);
await h.palette('palette'); await h.esc();
const focusAfter = await main.eval(`document.activeElement?.getAttribute('aria-label')`);
record('A7 焦点归位:打开前焦点在统一输入框 -> Esc 后焦点回统一输入框',
  focusBefore === '统一输入框' && focusAfter === '统一输入框', `${focusBefore} -> ${focusAfter}`);

// ---- A8 编辑态保护 ----
const MARK = 'T9编辑态落库标记' + STAMP;
await h.clickSel(`[data-note-body="${fixture.id}"]`);
const panelOn = await main.eval(`!!document.querySelector('[data-testid="edit-panel"] textarea')`);
await h.type(MARK);
const domHas = await main.eval(`document.querySelector('[data-testid="edit-panel"] textarea')?.value.includes(${JSON.stringify(MARK)})`);
const dbBefore = await hits(MARK);
await h.palette('palette'); await h.type('侧栏'); await h.press(KEYS.enter);
const dbAfter = await hits(MARK);
record('A8 编辑中执行命令 -> 内容已落库(落库前库无、落库后有)',
  panelOn === true && domHas === true && dbBefore.length === 0 && dbAfter.length === 1 && dbAfter[0].id === fixture.id,
  `面板在场=${panelOn} DOM含标记=${domHas} 库命中(前)=${dbBefore.length} 库命中(后)=${dbAfter.length} id=${dbAfter[0]?.id}`);
await h.palette('palette'); await h.type('侧栏'); await h.press(KEYS.enter);

// ---- A5 快捷键自设(放最后:改键后浮层入口变化) ----
await h.clickSel('button[aria-label="设置"]');
await sleep(700);
await h.clickSel('button[aria-label="录制快捷键:快速打开笔记"]');
await h.press(KEYS.k, CTRL_ALT);
const recText = await main.eval(`document.querySelector('button[aria-label^="录制快捷键:快速打开笔记"]')?.textContent.trim()`);
const stored = await h.call('get_setting', { key: 'main_quick_open_hotkey' });
await h.clickText('返回信息流');
await sleep(500);
await h.press(KEYS.k, CTRL_ALT);
const newKey = await h.state();
await h.esc();
await h.press(KEYS.p, CTRL);
const oldKey = await h.state();
await h.esc();
record('A5 快捷键自设:录成 Ctrl+Alt+K -> 新键生效、旧键失效、落库',
  stored === 'ctrl+alt+k' && newKey.open === true && oldKey.open === false,
  `显示=${JSON.stringify(recText)} 库值=${JSON.stringify(stored)} 新键打开=${newKey.open} 旧键打开=${oldKey.open}`);

// ---- 收尾:删净夹具(保留 A5 键值,重启持久化由 accept-fresh 复核) ----
for (const kw of [STAMP, `${FIX}夹具`]) for (const n of await hits(kw)) await h.call('delete_note', { id: n.id });
for (const p of [`${FIX}/夹具`, `${FIX}/项目A`]) {
  const t = await h.tagByPath(p);
  if (t) await h.call('delete_tag', { tagId: t.id });
}
const left = (await h.call('list_tags')).filter((t) => t.path.startsWith(FIX)).map((t) => t.path);
record('收尾:夹具删净(笔记 0 / T9验收 标签 0)',
  left.length === 0 && (await hits(`${FIX}夹具`)).length === 0,
  `残留标签=${JSON.stringify(left)} 残留笔记=${(await hits(`${FIX}夹具`)).length} 告警=${JSON.stringify(await h.alerts())}`);

finish();
process.exit(process.exitCode ?? 0);
