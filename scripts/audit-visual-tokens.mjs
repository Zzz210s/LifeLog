#!/usr/bin/env node
/**
 * 视觉令牌审计门禁(设计 §5-1 / D11)。CDP 连**运行中的主窗**,用计算样式断言:
 *   1) 字号只取 7 档   2) 圆角只取 4/6/8/12 且按组件对档   3) gap 只取刻度表
 *   4) 颜色必须来自 theme.css 令牌   5) 笔记卡片有 hover 与 focus 态   6) 正文对比度 >= 4.5:1
 * 并打印「改前(基线 audit.json)→ 改后(实时)」分布对照表。用法:pnpm audit:visual
 * 退出码:0 通过 / 1 失败 / 2 跳过(应用不在 9222 或主窗不在信息流)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, ensureMain, recorder, sleep } from './cdp-lib.mjs';
import { recordTopBarMenu } from './audit-visual-menu.mjs';
import {
  BLUR_JS, CARD_STATE_JS, CLOSE_DIALOG_JS, MENU_SCAN_JS, OPEN_DIALOG_JS, PICK_CARDS_JS,
  REAL_FOCUS_JS, SCAN_JS, TOKEN_NAMES,
} from './audit-visual-scan.mjs';
const SIZES = [11, 12, 13, 14, 15, 16, 20]; // 7 档类型刻度
const RADII = [4, 6, 8, 12]; // 圆角 4 档(0 只作标签页下两角,见断言)
const GAPS = [4, 6, 8, 12, 16, 24, 32]; // 间距刻度(设计 §3.3;2px 未用)
const TRANSPARENT = ['rgba(0, 0, 0, 0)', 'transparent'];
const px = (v) => parseFloat(String(v));
const corners = (r) => String(r).split(/\s+/).map(px);
const fmt = (list, top = 6) => (list || []).slice(0, top).map(([v, c]) => `${v}×${c}`).join(' ') || '(空)';
const values = (list) => [...new Set((list || []).map(([v]) => String(px(v))))].sort((a, b) => a - b).join('/');

try {
  await fetch(`${BASE}/json/version`, { signal: AbortSignal.timeout(2500) });
} catch {
  console.log(`跳过视觉令牌审计:应用未在 ${BASE} 上运行(先以 --remote-debugging-port=${BASE.split(':').pop()} 启动应用,或用 LIFELOG_CDP_PORT 换端口)`);
  process.exit(2);
}

let baseline = null;
const basePath = resolve(dirname(fileURLToPath(import.meta.url)), '../.superpowers/sdd/2026-09-22-visual/audit.json');
try {
  baseline = JSON.parse(readFileSync(basePath, 'utf8'))['主窗亮色'];
} catch {
  console.log('提示:读不到基线 .superpowers/sdd/2026-09-22-visual/audit.json,对照表只打印当前值');
}

const { cdp } = await ensureMain();
const js = (e) => cdp.eval(e);
const r = recorder();

// 亮暗各扫一次(最后还原初始主题):颜色断言用两态令牌并集,故在哪个主题下跑都成立
const startDark = await js(`document.documentElement.classList.contains('dark')`);
await js(`document.documentElement.classList.remove('dark')`);
await sleep(700);
const light = await js(SCAN_JS);
if (light.cardVisible === 0) {
  console.log('跳过视觉令牌审计:主窗当前不在信息流视图(看不到笔记卡片),请切回信息流再跑');
  process.exit(2);
}await js(`document.documentElement.classList.add('dark')`);
await sleep(700);
const dark = await js(SCAN_JS);
await js(startDark ? `document.documentElement.classList.add('dark')` : `document.documentElement.classList.remove('dark')`);
await sleep(600); // 等主题过渡(150ms)结束,否则卡片读数会落在过渡中间
const scans = [light, dark];
const tokenSet = new Set([...light.tokenColors, ...dark.tokenColors, ...TRANSPARENT]);

// 1) 令牌齐全:漏定义/改名会让颜色集合静默变小,故单独断言
const missing = TOKEN_NAMES.filter((n) => !light.tokens[n]);
r.record('令牌齐全(theme.css 全部 --color-*)', missing.length === 0, missing.join(' ') || `${TOKEN_NAMES.length} 个令牌均非空`);

// 2) 字号 7 档
const badFs = scans.flatMap((s) => s.fontSize.filter(([v]) => !SIZES.includes(px(v))).map(([v, c]) => `${s.theme} ${v}×${c}`));
r.record('字号只在 7 档(11-16/20)', badFs.length === 0, badFs.join(' ') || `改后 ${fmt(light.fontSize)}`);

// 3) 圆角:四角都取刻度值(0 只允许作标签页下两角),且至少一角非零
const badRad = scans.flatMap((s) => s.radius.filter(([v]) => {
  const c = corners(v);
  return c.some((x) => ![0, ...RADII].includes(x)) || !c.some((x) => RADII.includes(x));
}).map(([v, c]) => `${s.theme} ${v}×${c}`));
r.record('圆角只在 4 档(4/6/8/12;0 仅标签页下两角)', badRad.length === 0, badRad.join(' ') || `改后 ${fmt(light.radius)}`);

// 4) gap 只在刻度表
const badGap = scans.flatMap((s) => s.gap.filter(([v]) => !GAPS.includes(px(v))).map(([v, c]) => `${s.theme} ${v}×${c}`));
r.record('gap 只在刻度表(4/6/8/12/16/24/32)', badGap.length === 0, badGap.join(' ') || `改后 ${fmt(light.gap)}`);

// 5) 颜色全部来自令牌(文字/背景/边框)
const badColor = scans.flatMap((s) =>
  [...s.colors.map((c) => ['文字', c]), ...s.bgs.map((c) => ['背景', c]), ...s.borders.map((c) => ['边框', c])]
    .filter(([, c]) => !tokenSet.has(c))
    .map(([k, c]) => `${s.theme} ${k} ${c}`),
);
r.record(
  '颜色全部来自令牌(文字/背景/边框)',
  badColor.length === 0,
  badColor.join(' ') || `令牌色 ${tokenSet.size} 个,文字 ${light.colors.length} / 背景 ${light.bgs.length} / 边框 ${light.borders.length} 种`,
);

// 6) 逐组件对档
r.record('笔记卡片 = 8px', light.card?.radius === '8px' && light.cardBadRadius === 0, `${light.cardCount} 张(可见 ${light.cardVisible}),圆角 ${light.card?.radius},越档 ${light.cardBadRadius}`);
r.record('chip = 4px', light.chipBadRadius === 0, `${light.chipCount} 个,圆角 ${light.chip?.radius},越档 ${light.chipBadRadius}`);
r.record('按钮 = 6px', light.iconButton?.radius === '6px', `图标按钮 ${light.iconButton?.h}×${light.iconButton?.w} 圆角 ${light.iconButton?.radius}`);
r.record(
  '输入框 = 6px',
  light.composer?.radius === '6px',
  `统一输入框 ${light.composer?.h}px/${light.composer?.radius}`,
);
r.record('标签页 = 6/6/0/0 且高 32', light.tabActive?.radius === '6px 6px 0px 0px' && light.tabActive?.h === 32, `活动页 ${light.tabActive?.h}px/${light.tabActive?.radius},非活动底 ${light.tabInactive?.bg}`);
// 浮层（命令面板）读数已随浮层外壳删除（Task 7）；统一输入框下拉的 6px + 阴影由
// unified-dropdown.dom.test.ts 钉住，模态浮层的 12px + 阴影由上面的菜单/对话框两条覆盖。

// 7) 卡片三态:hover / focus-within 用 CDP 强制伪类读计算样式差;对照卡片避开真实鼠标悬停的那张
await cdp.send('DOM.enable');
await cdp.send('CSS.enable');
const pick = await js(PICK_CARDS_JS);
// 每次强制前重取 nodeId:HMR/重渲会让上一次的 nodeId 失效(失效时伪类作用在旧节点上,读数为假阴性)
const force = async (list) => {
  const d = await cdp.send('DOM.getDocument', { depth: 1 });
  const ids = (await cdp.send('DOM.querySelectorAll', { nodeId: d.root.nodeId, selector: '#root ul li' })).nodeIds;
  await cdp.send('CSS.forcePseudoState', { nodeId: ids[pick.target], forcedPseudoClasses: list });
  await sleep(320);
};
const base = await js(CARD_STATE_JS(pick.target));
const ref = await js(CARD_STATE_JS(pick.ref));
await force(['hover']);
const hover = await js(CARD_STATE_JS(pick.target));
await force(['focus-within']);
let focus = await js(CARD_STATE_JS(pick.target));
if (focus?.actionOpacity !== '1') {
  await force(['focus-within']);
  focus = await js(CARD_STATE_JS(pick.target));
}
await force([]);
const realFocus = await js(REAL_FOCUS_JS(pick.target));
await js(BLUR_JS);
r.record(
  '卡片 hover 态(背景变化)',
  !!hover && hover.bg === hover.hoverToken && ref?.bg === ref.raisedToken,
  `静止卡 ${ref?.bg}(= --color-raised ${ref?.raisedToken}) -> 强制 hover ${hover?.bg}(= --color-hover ${hover?.hoverToken})`,
);
// 环:规则必须在(与 OS 焦点无关);窗口有焦点时再核对实时值
const ringLive = realFocus?.outlineStyle === 'solid' && realFocus?.outlineColor === realFocus?.accent;
r.record(
  '卡片 focus 态(键盘通道显形 + accent 环)',
  !!focus && focus.actionOpacity === '1' && ref?.actionOpacity === '0' && realFocus?.ruleOk === true && (!realFocus?.docFocused || ringLive),
  `操作行 opacity 对照卡 ${ref?.actionOpacity} -> focus-within ${focus?.actionOpacity};环规则 ${realFocus?.ruleOk ? '在' : '缺失'}${realFocus?.docFocused ? `(窗口有焦点,实时 ${realFocus?.outlineWidth} ${realFocus?.outlineColor})` : '(窗口无 OS 焦点,只校规则)'}`,
);

// 8) 正文对比度(亮暗两态)
const badContrast = scans.filter((s) => !s.contrast || s.contrast.ratio < 4.5).map((s) => `${s.theme} ${s.contrast?.ratio}`);
r.record(
  '正文对比度 >= 4.5:1(WCAG)',
  badContrast.length === 0,
  badContrast.join(' ') || scans.map((s) => `${s.theme} ${s.contrast.ratio}:1(${s.contrast.fg} on ${s.contrast.bg})`).join(' '),
);

// 9) 浮层/对话框档位(逐个开一遍菜单与表达式对话框,含顶栏 ⋯ 溢出菜单,读数在 audit-visual-menu.mjs)
const menus = await js(MENU_SCAN_JS);
const menuBad = menus.filter((m) => m.menu?.radius !== '12px' || m.menu?.shadow === 'none');
r.record(
  '菜单浮层 = 12px + 阴影',
  menus.length > 0 && menuBad.length === 0,
  menus.map((m) => `${m.label}:${m.menu?.radius}/${m.menu?.shadow === 'none' ? '无阴影' : '有阴影'}`).join(' ') || '没有可开的下拉菜单',
);
await recordTopBarMenu(js, r);
const dialog = await js(OPEN_DIALOG_JS);
const closed = await js(CLOSE_DIALOG_JS);
r.record(
  '对话框 = 12px + 阴影,内部按钮/输入 6px(示例 chip 4px)',
  dialog.ok && dialog.dialog?.radius === '12px' && dialog.dialog?.shadow !== 'none' && dialog.buttons.includes('6px') && dialog.buttons.every((b) => ['4px', '6px'].includes(b)) && dialog.inputs.every((b) => b === '6px'),
  dialog.ok ? `圆角 ${dialog.dialog?.radius},按钮 ${dialog.buttons.filter((b) => b === '6px').length}×6px/${dialog.buttons.filter((b) => b === '4px').length}×4px(chip),输入 ${[...new Set(dialog.inputs)].join('/')},字号 ${dialog.fontSize.join('/')}` : dialog.why,
);
r.record('对话框已关闭(不留状态)', closed, closed ? '取消关闭,未加筛选条件' : '对话框仍在');

// 10) 布局读数:顶区高度与内容列宽(设计 D9/D10)
r.record('顶区 <= 210px', light.topRegion !== null && light.topRegion <= 210, `内容区上沿 y = ${light.topRegion}(基线 244)`);
r.record(
  '内容列宽随侧栏切换(可见 max-w-3xl=768 / 隐藏 max-w-5xl=1024)',
  light.columnClass === (light.sidebar ? 'max-w-3xl' : 'max-w-5xl'),
  `侧栏${light.sidebar ? '可见' : '隐藏'}:${light.columnClass} 实测 ${light.column}px(隐藏档 1024 由 shell/content-column.test.ts 覆盖)`,
);

console.log('\n=== 前后分布对照(改前 = 基线 audit.json,改后 = 实时) ===');
if (baseline) {
  const rows = [
    ['元素数', `${baseline['元素数']}`, `${light.n}(侧栏展开,笔记 ${light.cardCount} 条)`],
    ['字号', fmt(baseline['字号']), fmt(light.fontSize)],
    ['字号集合', values(baseline['字号']), values(light.fontSize)],
    ['行高', fmt(baseline['行高'], 4), fmt(light.lineHeight, 4)],
    ['圆角', fmt(baseline['圆角']), fmt(light.radius)],
    ['gap', fmt(baseline['gap']), fmt(light.gap)],
    ['文字色', fmt(baseline['文字色'], 5), fmt(light.color, 5)],
    ['背景色', fmt(baseline['背景色'], 4), fmt(light.bg, 4)],
    ['边框色', fmt(baseline['边框色'], 3), fmt(light.borderColor, 3)],
    ['阴影', `${baseline['阴影'].length} 处(全透明层 = 无真阴影)`, `可见 ${light.shadowCount} 处;浮层/菜单 shadow-lg(上面断言已读)`],
    ['顶区高度', '244px', `${light.topRegion}px`],
    ['内容列宽', '768px(侧栏隐藏也 768)', `${light.column}px(侧栏可见)`],
  ];
  for (const [k, a, b] of rows) console.log(`  ${k.padEnd(6, ' ')} 改前 ${String(a).padEnd(46, ' ')} 改后 ${b}`);
} else {
  console.log(`  字号 ${fmt(light.fontSize)} / 圆角 ${fmt(light.radius)} / gap ${fmt(light.gap)} / 顶区 ${light.topRegion}px / 列宽 ${light.column}px`);
}
r.finish();
console.log(`审计读数:accent 文字 chip ${light.chipAccentText}/${light.chipCount}(基线 128/128),卡片底 ${light.cardBg},边框元素 ${light.borderCount}(基线 5),阴影元素 ${light.shadowCount}(基线 1),次级文字对比度 ${light.contrastMuted?.ratio}:1`);
process.exit(r.results.some((x) => !x.ok) ? 1 : 0);
