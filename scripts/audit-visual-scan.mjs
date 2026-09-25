// 视觉令牌审计的「页面侧」代码(注入主窗执行的那几段 JS)。
// 与 scripts/audit-visual-tokens.mjs 分开,是为了让两边都留在 200 行以内。
// 口径说明:
//   1) 分布统计只取**当前可见**元素(`#root *` 里有盒子),与基线 .superpowers/sdd/2026-09-22-visual/audit.json 同口径;
//      隐藏视图(设置页等)由 V5 的源码门禁测试覆盖,不在这里重复。
//   2) 排除 `.md-body` 子树 —— markdown 内部是 em 相对字号(h1 = 1.4em、code = 0.9em),属内容而非 chrome 刻度。
//   3) 颜色断言用「亮暗两态令牌值的并集」,故在哪个主题下跑都能识别另一态的值。
/** theme.css 里全部 --color-* 令牌(改名/漏定义会让审计报「令牌缺失」而不是静默放过) */
export const TOKEN_NAMES = (
  'canvas chrome chrome-alt raised hover selected accent accent-text accent-soft border border-strong ' +
  'text muted faint app panel tag active danger danger-soft danger-hover accent-hover on-accent ' +
  'on-danger knob overlay success warn warn-soft'
).split(' ').map((n) => `--color-${n}`);
/** 页面侧小工具:可见判定 / 令牌解析 / 取值计数 / WCAG 对比度 */
const HELPERS = `
  const root = document.documentElement;
  const cs = (el) => getComputedStyle(el);
  const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const inMd = (el) => !!el.closest('.md-body');
  const norm = (c) => { const d = document.createElement('div'); d.style.color = c; document.body.appendChild(d); const v = cs(d).color; d.remove(); return v; };
  const tally = (nodes, fn) => { const m = new Map(); for (const el of nodes) { const v = fn(el); if (!v) continue; m.set(v, (m.get(v) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const read = (el) => { if (!el) return null; const c = cs(el); const b = el.getBoundingClientRect();
    return { cls: String(el.className || '').slice(0, 96), h: Math.round(b.height), w: Math.round(b.width),
      radius: c.borderRadius, bg: c.backgroundColor, color: c.color, borderColor: c.borderTopColor,
      borderWidth: c.borderTopWidth, shadow: c.boxShadow, fontSize: c.fontSize }; };
  const effBg = (el) => { let p = el; while (p) { const c = cs(p).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; p = p.parentElement; } return 'rgb(255, 255, 255)'; };
  const lum = (s) => { const m = s.match(/[\\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const ratio = (a, b) => { const p = [lum(a), lum(b)].sort((x, y) => y - x); return Math.round(((p[0] + 0.05) / (p[1] + 0.05)) * 100) / 100; };
  const cards = [...document.querySelectorAll('#root ul li')].filter((li) => li.querySelector('.md-body'));
`;

/** 主扫描:分布 + 令牌集合 + 逐组件读数(在调用时的主题下取值) */
export const SCAN_JS = `(() => {
${HELPERS}
  const nodes = [...document.querySelectorAll('#root *')].filter((el) => vis(el) && !inMd(el));
  const tokenNames = ${JSON.stringify(TOKEN_NAMES)};
  const tokens = {}; for (const n of tokenNames) tokens[n] = cs(root).getPropertyValue(n).trim();
  const tokenColors = [...new Set(Object.values(tokens).filter(Boolean).map(norm))].sort();
  const colors = new Set(); const bgs = new Set(); const borders = new Set();
  for (const el of nodes) {
    const c = cs(el);
    colors.add(c.color);
    if (c.backgroundColor !== 'rgba(0, 0, 0, 0)') bgs.add(c.backgroundColor);
    if (parseFloat(c.borderTopWidth) > 0) borders.add(c.borderTopColor);
    if (parseFloat(c.borderLeftWidth) > 0) borders.add(c.borderLeftColor);
  }
  const listUl = [...document.querySelectorAll('#root ul')].find((u) => u.querySelector('li'));
  const header = document.querySelector('#root header');
  const chips = [...document.querySelectorAll('#root ul li button[aria-pressed]')];
  const body = cards[0] ? cards[0].querySelector('.md-body') : null;
  const muted = [...document.querySelectorAll('#root *')].find((el) => vis(el) && cs(el).color === norm(tokens['--color-muted']));
  const column = [...document.querySelectorAll('#root div')].find((d) => /(^|\\s)mx-auto(\\s|$)/.test(String(d.className)) && String(d.className).includes('flex-1'));
  return {
    theme: root.classList.contains('dark') ? 'dark' : 'light',
    n: nodes.length,
    fontSize: tally(nodes, (el) => cs(el).fontSize),
    lineHeight: tally(nodes, (el) => cs(el).lineHeight),
    radius: tally(nodes, (el) => (cs(el).borderRadius === '0px' ? null : cs(el).borderRadius)),
    gap: tally(nodes, (el) => cs(el).gap.split(/\\s+/).filter((x) => x !== 'normal').join(' ') || null),
    color: tally(nodes, (el) => cs(el).color),
    bg: tally(nodes, (el) => (cs(el).backgroundColor === 'rgba(0, 0, 0, 0)' ? null : cs(el).backgroundColor)),
    borderColor: tally(nodes, (el) => (parseFloat(cs(el).borderTopWidth) > 0 ? cs(el).borderTopColor : null)),
    borderCount: nodes.filter((el) => parseFloat(cs(el).borderTopWidth) > 0).length,
    shadowCount: nodes.filter((el) => cs(el).boxShadow !== 'none').length,
    tokens,
    tokenColors,
    colors: [...colors].sort(),
    bgs: [...bgs].sort(),
    borders: [...borders].sort(),
    topRegion: listUl ? Math.round(listUl.getBoundingClientRect().top) : null,
    column: header ? Math.round(header.getBoundingClientRect().width) : null,
    columnClass: column ? (String(column.className).includes('max-w-5xl') ? 'max-w-5xl' : 'max-w-3xl') : null,
    sidebar: !!document.querySelector('#root aside'),
    card: read(cards[0]),
    cardCount: cards.length,
    cardVisible: cards.filter(vis).length,
    cardBadRadius: cards.filter((c) => cs(c).borderRadius !== '8px').length,
    cardBg: cards[0] ? cs(cards[0]).backgroundColor : null,
    chip: read(chips[0]),
    chipCount: chips.length,
    chipBadRadius: chips.filter((c) => cs(c).borderRadius !== '4px').length,
    chipAccentText: chips.filter((c) => cs(c).color === tokens['--color-accent-text']).length,
    iconButton: read(document.querySelector('#root header button')),
    composer: read(document.querySelector('#root [data-testid="unified-input"]')),
    contrast: body ? { fg: cs(body).color, bg: effBg(body), ratio: ratio(cs(body).color, effBg(body)), fontSize: cs(body).fontSize } : null,
    contrastMuted: muted ? { fg: cs(muted).color, bg: effBg(muted), ratio: ratio(cs(muted).color, effBg(muted)) } : null,
  };
})()`;

/** 卡片三态:按序号读卡片与其操作行(序号由 PICK_CARDS_JS 选,避开真实鼠标悬停的那张) */
export const CARD_STATE_JS = (index = 0) => `(() => {
${HELPERS}
  const li = document.querySelectorAll('#root ul li')[${index}];
  if (!li) return null;
  const row = li.querySelector('div.ml-auto');
  return { bg: cs(li).backgroundColor, actionOpacity: row ? cs(row).opacity : null,
    hoverToken: norm(cs(root).getPropertyValue('--color-hover').trim()), raisedToken: norm(cs(root).getPropertyValue('--color-raised').trim()) };
})()`;

/** 选两张可见卡片:target = 第一张;ref = 当前未被真实鼠标悬停的那张(作对照基准) */
export const PICK_CARDS_JS = `(() => {
${HELPERS}
  const hoverColor = norm(cs(root).getPropertyValue('--color-hover').trim());
  const all = [...document.querySelectorAll('#root ul li')];
  const target = all.findIndex(vis);
  const ref = all.findIndex((el, i) => i !== target && vis(el) && cs(el).backgroundColor !== hoverColor);
  return { target, ref };
})()`;

/** 真实聚焦卡片内的键盘通道按钮(全局 :focus-visible 环 + sr-only 显形) */
export const REAL_FOCUS_JS = (index = 0) => `(() => {
${HELPERS}
  const li = document.querySelectorAll('#root ul li')[${index}];
  const btn = li && li.querySelector('button');
  if (!btn) return null;
  btn.focus();
  const c = cs(btn);
  // 环规则是否在样式表里(无 OS 焦点时 Chromium 不匹配 :focus-visible,只读实时 outline 会假阴性)
  let ruleOk = false;
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
    for (const r of rules) if (r.selectorText && r.selectorText.includes(':focus-visible') && /1px/.test(r.style.outlineWidth || r.style.outline || '')) ruleOk = true;
  }
  return { focused: document.activeElement === btn, docFocused: document.hasFocus(), ruleOk,
    outlineStyle: c.outlineStyle, outlineColor: c.outlineColor,
    outlineWidth: c.outlineWidth, position: c.position, clipPath: c.clipPath, textDecoration: c.textDecorationLine,
    cardBg: cs(li).backgroundColor, accent: norm(cs(root).getPropertyValue('--color-accent').trim()) };
})()`;

export const BLUR_JS = `(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return true; })()`;

/** 逐个开一遍下拉菜单(设计 §4-9:菜单属浮层,radius-lg + shadow-lg),读完 Esc 关掉 */
export const MENU_SCAN_JS = `(async () => {
${HELPERS}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const out = [];
  for (const btn of [...document.querySelectorAll('#root button[aria-haspopup="menu"]')].filter(vis)) {
    esc(); await sleep(150);
    btn.click(); await sleep(180);
    const menu = [...btn.parentElement.querySelectorAll('[role=menu]')].find(vis) || [...document.querySelectorAll('#root [role=menu]')].find(vis);
    out.push({ label: btn.textContent.trim().slice(0, 6), menu: read(menu) });
    esc(); await sleep(150);
  }
  return out;
})()`;

/** 开「添加条件」菜单 → 点「表达式(高级)」→ 读对话框容器与内部控件档位。
 * 菜单入口:条件栏的触发按钮已在 Task 2 搬走,这里走 `>` 命令(顶栏菜单项跑的是同一条命令)。 */
export const OPEN_DIALOG_JS = `(async () => {
${HELPERS}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const box = document.querySelector('#root [data-testid="unified-input"]');
  if (!box) return { ok: false, why: '没有统一输入框' };
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  set.call(box, '>添加条件'); box.dispatchEvent(new Event('input', { bubbles: true }));
  const rows = () => [...document.querySelectorAll('#root [data-testid="unified-dropdown"] li[role="option"]')]
    .filter((li) => li.textContent.includes('添加条件'));
  let row = rows()[0];
  for (let i = 0; i < 12 && !row; i++) { await sleep(250); row = rows()[0]; }
  if (!row) return { ok: false, why: '「>添加条件」没有候选行' };
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(600);
  set.call(box, ''); box.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(200);
  const item = [...document.querySelectorAll('#root [role=menuitem]')].find((b) => b.textContent.includes('表达式'));
  if (!item) return { ok: false, why: '菜单里没有「表达式(高级)」项' };
  item.click(); await sleep(280);
  const dlg = document.querySelector('#root [role=dialog][aria-label="表达式"]');
  if (!dlg) return { ok: false, why: '对话框未出现' };
  return { ok: true, dialog: read(dlg),
    buttons: [...dlg.querySelectorAll('button')].map((b) => cs(b).borderRadius),
    inputs: [...dlg.querySelectorAll('input, textarea')].map((b) => cs(b).borderRadius),
    fontSize: [...new Set([...dlg.querySelectorAll('*')].map((el) => cs(el).fontSize))].sort() };
})()`;

/** 关掉对话框(点「取消」,不落任何筛选条件);返回是否已关闭 */
export const CLOSE_DIALOG_JS = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const dlg = document.querySelector('#root [role=dialog][aria-label="表达式"]');
  if (!dlg) return true;
  const cancel = [...dlg.querySelectorAll('button')].find((b) => b.textContent.trim() === '取消');
  if (cancel) cancel.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(200);
  return !document.querySelector('#root [role=dialog][aria-label="表达式"]');
})()`;

/** 临时把侧栏移出布局再统计(基线 audit.json 是侧栏隐藏时采的),只改内存里的内联样式 */
export const SET_SIDEBAR_JS = (hide) => `(() => {
  const aside = document.querySelector('#root aside');
  if (!aside) return false;
  aside.style.display = ${hide ? "'none'" : "''"};
  return true;
})()`;
