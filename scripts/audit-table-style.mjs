#!/usr/bin/env node
/**
 * 表格视觉门禁(风格 B 数据密集):真机建一条含表格的临时笔记,用计算样式断言
 *   表头(底=chrome-alt / 2px 底边 / 12px / sticky)/ 单元格(4-8 padding / top / 26em)/
 *   单双行同色(无斑马纹)/ 悬停 = selected / 短行 36px 且长文本完整可见 /
 *   8 列宽表横向滚动不撑破卡片 / 零硬编码色 / 暗色正文对比度(AA)。
 * 夹具自建自删(前缀 `TABLE测试`),不碰用户数据。退出码:0 通过 / 1 失败 / 2 跳过(应用不在 CDP 端口)。
 */
import { BASE, ensureMain, recorder, sleep, waitFor } from './cdp-lib.mjs';
import { READY_JS } from './audit-visual-ready.mjs';
import { FIND_JS, HOVER_READ_JS, HOVER_RECT_JS, MARK_TR_JS, SCAN_JS } from './audit-table-scan.mjs';

const NS = 'TABLE测试';
const LONG = '这是一段刻意写得很长的备注文本用来验证单元格换行后行高会随内容增长而且不会被裁切也不会出现省略号内容完整可见这是必须成立的';
const CONTENT = [
  `${NS} 表格门禁`, '',
  '| 名称 | 数量 | 备注 |',
  '| :--- | ---: | :--- |',
  '| 短 | 12 | 紧凑 |',
  `| 长文本列 | 3456 | ${LONG} |`,
  '|  | 78 | 空单元格 |', '',
  '| 列一 | 列二 | 列三 | 列四 | 列五 | 列六 | 列七 | 列八 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |',
  '| a | b | c | d | e | f | g | h |', '',
  // 第 3 张表:30 行,超过 max-height(70vh) → 表格内部纵向滚动,表头才有可粘的地方
  '| 序号 | 名称 | 数量 |', '| ---: | :--- | ---: |',
  ...Array.from({ length: 30 }, (_, i) => `| ${i + 1} | 第 ${i + 1} 行 | ${(i + 1) * 10} |`),
].join('\n');
const kw = { keyword: NS, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null };
const lum = (s) => {
  const m = String(s).match(/[\d.]+/g).map(Number);
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
};
const ratio = (a, b) => { const p = [lum(a), lum(b)].sort((x, y) => y - x); return Math.round(((p[0] + 0.05) / (p[1] + 0.05)) * 100) / 100; };
// 显示缩放 125% 时边框会按设备像素吸附:1px 计算值读作 0.8px、2px 读作 1.6px,故边框宽度带容差
const near = (v, want, tol = 0.45) => Math.abs(parseFloat(String(v)) - want) <= tol;

try { await fetch(`${BASE}/json/version`, { signal: AbortSignal.timeout(2500) }); } catch {
  console.log(`跳过表格视觉门禁:应用未在 ${BASE} 上运行(先以 --remote-debugging-port=9222 启动 pnpm tauri dev)`);
  process.exit(2);
}
const { cdp } = await ensureMain();
const js = (e) => cdp.eval(e);
const call = (cmd, args = {}) =>
  js(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const r = recorder();

/** 逐主题断言(亮/暗各跑一遍;颜色对比都用该主题的令牌真值) */
function assertScan(s, theme) {
  const tok = s.tok;
  r.record(
    `表头 th(${theme}):底=chrome-alt / 底边 2px / 字号 12px / sticky 真钉住(长表内部滚动后仍在顶部)`,
    s.th.bg === tok['--color-chrome-alt'] && near(s.th.borderBottomWidth, 2) && s.th.fontSize === '12px'
      && s.th.position === 'sticky' && s.th.top === '0px'
      && s.sticky.tallTableScrolls === true && s.sticky.headerStuckOffset <= 2,
    `底 ${s.th.bg} / 底边 ${s.th.borderBottomWidth} / 字号 ${s.th.fontSize} / ${s.th.position}@${s.th.top} / 内距 ${s.th.padding} / 长表可滚=${s.sticky.tallTableScrolls} 表头偏移=${s.sticky.headerStuckOffset}px`,
  );
  r.record(
    `单元格 td(${theme}):内距 4/8 / 顶对齐 / max-width 26em / 底边 1px`,
    s.td.paddingTop === '4px' && s.td.paddingBottom === '4px' && s.td.paddingLeft === '8px'
      && s.td.paddingRight === '8px' && s.td.verticalAlign === 'top' && s.td.maxWidth === '312px'
      && near(s.td.borderBottomWidth, 1),
    `内距 ${s.td.paddingTop}/${s.td.paddingLeft} / ${s.td.verticalAlign} / max-width ${s.td.maxWidth} / 底边 ${s.td.borderBottomWidth}`,
  );
  r.record(
    `表框(${theme}):1px border-strong / 字号 12px / 横向滚动容器`,
    near(s.table.borderTopWidth, 1) && s.table.borderTopStyle === 'solid'
      && s.table.borderTopColor === tok['--color-border-strong'] && s.table.fontSize === '12px'
      && s.table.display === 'block' && s.table.overflowX === 'auto',
    `边框 ${s.table.borderTopWidth} ${s.table.borderTopStyle} ${s.table.borderTopColor} / 字号 ${s.table.fontSize} / display ${s.table.display} / overflow-x ${s.table.overflowX}`,
  );
  r.record(
    `单双行背景一致(${theme}):无斑马纹`,
    s.zebra?.bg === s.zebra?.oddBg,
    `单行底 ${s.zebra?.oddBg} / 双行底 ${s.zebra?.bg}(必须相等)`,
  );
  r.record(
    `短行 36px / 长文本行高 > 36 且完整可见(不裁切、无省略号)`,
    s.shortRowH === 36 && s.long?.h > 36 && s.long.scrollHeight <= s.long.clientHeight + 1
      && s.long.textOverflow === 'clip' && s.long.whiteSpace !== 'nowrap' && s.long.text === LONG,
    `短行 ${s.shortRowH}px / 长行 ${s.long?.h}px(scrollH ${s.long?.scrollHeight} <= clientH ${s.long?.clientHeight}) / ${s.long?.whiteSpace}/${s.long?.textOverflow} / 文本 ${s.long?.text?.length} 字${s.long?.text === LONG ? '一致' : '不一致'}`,
  );
  const bad = s.colors.filter((c) => !s.tokenColors.includes(c));
  r.record(
    `零硬编码色(${theme}):表格子树颜色全来自令牌`,
    bad.length === 0,
    bad.join(' ') || `${s.colors.length} 种颜色均在 ${s.tokenColors.length} 个令牌值内`,
  );
}

/** 悬停读数:先真实鼠标移入,失败再退到 CDP 强制 :hover(与 audit-visual-card 同手法) */
async function hoverRead() {
  const at = await js(HOVER_RECT_JS(NS));
  if (!at) return null;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, buttons: 0 });
  await sleep(450);
  let read = await js(HOVER_READ_JS(NS));
  if (read && read.bg === read.selected) return { ...read, via: '真实鼠标移入' };
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  await js(MARK_TR_JS(NS, true));
  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const ids = (await cdp.send('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: '[data-audit-tr]' })).nodeIds;
  if (ids.length) await cdp.send('CSS.forcePseudoState', { nodeId: ids[0], forcedPseudoClasses: ['hover'] });
  await sleep(320);
  read = await js(HOVER_READ_JS(NS));
  if (ids.length) await cdp.send('CSS.forcePseudoState', { nodeId: ids[0], forcedPseudoClasses: [] });
  await js(MARK_TR_JS(NS, false));
  return read ? { ...read, via: 'CDP 强制 :hover' } : null;
}

/** 把真实鼠标挪到视口角落:悬停态会残留,污染后续主题的行底色读数(实测暗色读到 selected) */
const parkMouse = () => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2, buttons: 0 });

// 回到已知状态:退关系图/设置、清条件 chip、清空统一输入框;并清掉上次残留夹具
await js(READY_JS);
await js(`(() => { const b = document.querySelector('[data-testid="unified-input"]'); if (!b) return false;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(b, '');
  b.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await sleep(300);
for (const n of await call('query_notes', { conditions: kw, offset: 0 })) await call('delete_note', { id: n.id });
await sleep(400);

let noteId = null;
try {
  noteId = (await call('save_input_note', { content: CONTENT })).id;
  if (!(await waitFor(() => js(FIND_JS(NS)), 40, 250))) {
    r.record('夹具表格进入信息流', false, '新笔记的表格未在 DOM 出现(信息流未刷新?)');
  } else {
    const startDark = await js(`document.documentElement.classList.contains('dark')`);
    await parkMouse();
    await js(`document.documentElement.classList.remove('dark')`);
    await sleep(700);
    const light = await js(SCAN_JS(NS));
    assertScan(light, '亮色');
    const hover = await hoverRead();
    r.record(
      '悬停行底 = selected(压过行底色)',
      hover?.bg === hover?.selected && hover?.bg !== hover?.canvas,
      `悬停底 ${hover?.bg}(= --color-selected ${hover?.selected})via ${hover?.via};偶数行底 ${hover?.canvas}`,
    );
    r.record(
      '8 列宽表可横向滚动且不撑破卡片',
      light.wide.scrollWidth > light.wide.clientWidth && light.wide.w <= light.cardW + 1,
      `宽表 ${light.wide.w}px(scrollW ${light.wide.scrollWidth} > clientW ${light.wide.clientWidth});卡片 ${light.cardW}px`,
    );
    await parkMouse();
    await js(`document.documentElement.classList.add('dark')`);
    await sleep(800);
    const dark = await js(SCAN_JS(NS));
    assertScan(dark, '暗色');
    r.record(
      '暗色可读:正文对比度 >= 4.5:1',
      lum(dark.zebra.bg) < lum(dark.tok['--color-raised']) && ratio(dark.zebra.color, dark.zebra.bg) >= 4.5,
      `单双行同色 ${dark.zebra.bg};正文对比度 ${ratio(dark.zebra.color, dark.tok['--color-raised'])}:1(卡片底)`,
    );
    await js(startDark ? `document.documentElement.classList.add('dark')` : `document.documentElement.classList.remove('dark')`);
  }
} finally {
  if (noteId !== null) await call('delete_note', { id: noteId });
  await sleep(600);
}
const gone = await waitFor(
  async () => ((await call('query_notes', { conditions: kw, offset: 0 })).length === 0 ? true : null), 12, 250,
);
r.record('收尾 夹具删净(前缀 TABLE测试)', gone === true, gone ? '库内已无同名夹具' : '仍有残留');
r.finish();
process.exit(r.results.some((x) => !x.ok) ? 1 : 0);
