// 关系验收的 **DOM 读数 + 画布探针**(自 `relations-accept-lib.mjs` 拆出,守 200 行上限)。
// 只读页面、不改库;判定全留在主脚本(scripts/dev-relations-accept.mjs)。经 relations-accept-lib 再出口。
import { waitFor } from './carry-accept-lib.mjs';

const sel = (name, value) => `[${name}=' + JSON.stringify(${JSON.stringify(value)}) + ']`;
/** 侧栏某行末尾的引用小字(开关打开后才有;null = 行不在) */
export const relationChipsOf = (cdp, path) =>
  cdp.eval(`(() => { const r = document.querySelector('aside ${sel('data-tag-path', path)}');
    return r ? Array.from(r.querySelectorAll('[data-tag-relation]')).map((x) => x.textContent.trim()) : null; })()`);
/** 侧栏某行的悬浮卡片标题(data-tip 多行:路径 + 计数) */
export const rowTipOf = (cdp, path) =>
  cdp.eval(`(() => { const r = document.querySelector('aside ${sel('data-tag-path', path)}');
    return r ? r.getAttribute('data-tip') : null; })()`);
/** 侧栏某行 data-tip-rows(档案卡片的引用行 [{label,value}];无引用为 null) */
export const rowFactsOf = (cdp, path) =>
  cdp.eval(`(() => { const r = document.querySelector('aside ${sel('data-tag-path', path)}');
    const raw = r?.getAttribute('data-tip-rows'); if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } })()`);
/** 行内某元素上合成 mouseover(冒泡到 document 上的 HoverTip 委托);inner 是行内 JS 表达式 */
export const hoverInside = (cdp, path, inner) =>
  cdp.eval(`(() => { const r = document.querySelector('aside ${sel('data-tag-path', path)}'); const el = r && (${inner});
    if (!el) return false; const b = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 })); return true; })()`);
/** 当前悬浮气泡读数:标题两行 + 档案卡片引用行(左属性名 / 右值) */
export const bubbleFactsOf = (cdp) =>
  cdp.eval(`(() => { const t = document.querySelector('[data-testid="hover-tip"]'); if (!t) return null;
    return { text: t.textContent, labels: Array.from(t.querySelectorAll('[data-tip-row-label]')).map((x) => x.textContent),
      values: Array.from(t.querySelectorAll('[data-tip-row-value]')).map((x) => x.textContent) }; })()`);
/** 标签右键菜单的按钮文案(主面板应为五档) */
export const menuItemsOf = (cdp) =>
  cdp.eval(`(() => { const m = document.querySelector('[data-tag-menu]');
    return m ? Array.from(m.querySelectorAll('button')).map((b) => b.textContent.trim()).filter(Boolean) : null; })()`);
/**
 * 设置页「实体树里显示引用」开关的 aria-checked。
 * 2026-10-08:侧栏实体分区头部也挂了同名 `aria-label` 的图标按钮(用 `aria-pressed`),
 * 且它在 DOM 里更靠前 —— `querySelector('button[aria-label=…]')` 会先命中它,`aria-checked` 永远 null。
 * 设置页那颗是 `role="switch"`(`controls.tsx` 的 Toggle),按 role 定位。
 */
export const relToggleState = (cdp) =>
  cdp.eval(`document.querySelector('[role="switch"][aria-label="实体树里显示引用"]')?.getAttribute('aria-checked') ?? null`);
/** 点设置页那颗开关(同上,避开侧栏同名按钮) */
export const clickRelationToggle = (cdp) =>
  cdp.eval(`(() => { const b = document.querySelector('[role="switch"][aria-label="实体树里显示引用"]');
    if (!b) return false; b.click(); return true; })()`);
export const clickByLabelIn = (cdp, label) =>
  cdp.eval(`(() => { const b = document.querySelector('button[aria-label=' + JSON.stringify(${JSON.stringify(label)}) + ']');
    if (!b) return false; b.click(); return true; })()`);
export const openSettings = async (cdp) => {
  await clickByLabelIn(cdp, '设置');
  return waitFor(() => cdp.eval(`!!document.querySelector('[data-section-nav="relations"]')`), 20, 200);
};
export const pickRelationSection = (cdp) =>
  cdp.eval(`(() => { const b = document.querySelector('[data-section-nav="relations"]'); if (!b) return false; b.click(); return true; })()`);
export const backToStream = (cdp) =>
  cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === '返回信息流');
    if (!b) return false; b.click(); return true; })()`);
/** 关系图信息条的引用出/入度行 */
export const relationDegreesText = (cdp) =>
  cdp.eval(`document.querySelector('[data-testid="graph-relation-degrees"]')?.textContent ?? null`);
export const graphOpened = (cdp) => cdp.eval(`!!document.querySelector('[data-testid="graph-view"] canvas')`);

// --- 画布探针:引用边箭头 = 三顶点路径 fill;备注文字走 fillText;箭头记尖点/终点、点层记填充圆 ---
export const installRelationProbe = (cdp) =>
  cdp.eval(`(() => {
    if (window.__relV === 2) return true;
    const fresh = () => ({ segs: 0, arrowHeads: 0, texts: [], arrowTips: [], dots: [] });
    let cur = fresh();
    const st = { get: () => cur };
    const mine = (c) => c.canvas && c.canvas.closest && c.canvas.closest('[data-testid="graph-view"]') !== null;
    const P = CanvasRenderingContext2D.prototype;
    const real = {};
    for (const m of ['clearRect', 'beginPath', 'moveTo', 'lineTo', 'arc', 'stroke', 'fill', 'fillText']) real[m] = P[m];
    let verts = 0, head = null, tail = null, ring = null;
    P.clearRect = function (...a) {
      if (mine(this) && (cur.segs || cur.arrowHeads || cur.texts.length)) cur = fresh();
      return real.clearRect.apply(this, a);
    };
    P.beginPath = function (...a) { verts = 0; head = null; tail = null; ring = null; return real.beginPath.apply(this, a); };
    P.moveTo = function (x, y, ...r) { verts = 1; head = [x, y]; tail = [x, y]; return real.moveTo.call(this, x, y, ...r); };
    P.lineTo = function (x, y, ...r) { verts += 1; tail = [x, y]; return real.lineTo.call(this, x, y, ...r); };
    P.arc = function (x, y, rad, ...r) { if (mine(this)) ring = { x, y, r: rad }; return real.arc.call(this, x, y, rad, ...r); };
    P.stroke = function (...a) { if (mine(this) && verts >= 2) cur.segs += 1; return real.stroke.apply(this, a); };
    P.fill = function (...a) {
      if (mine(this)) {
        if (verts === 3 && head && tail) { cur.arrowHeads += 1; cur.arrowTips.push({ tip: head, end: tail }); }
        if (ring) cur.dots.push(ring);
      }
      return real.fill.apply(this, a);
    };
    P.fillText = function (t, ...a) { if (mine(this)) cur.texts.push(String(t)); return real.fillText.call(this, t, ...a); };
    window.__rel = st; window.__relV = 2; return true;
  })()`);
export const relationFrame = (cdp) => cdp.eval('window.__rel ? window.__rel.get() : null');
/** 在画布中心连发滚轮缩放(delta < 0 放大);每格等一帧 */
export const zoomBy = (cdp, ticks, delta) =>
  cdp.eval(`(async () => {
    const el = document.querySelector('[data-testid="graph-view"]');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    for (let i = 0; i < ${ticks}; i++) {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: ${delta}, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      await new Promise((res) => requestAnimationFrame(res));
    }
    return true;
  })()`);
/** 点图内搜索第一条候选(mousedown 才走组件的 onPick) */
export const pickSearchItem = (cdp) =>
  cdp.eval(`(() => { const b = document.querySelector('[data-testid="graph-search-item"]');
    if (!b) return false; b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return true; })()`);
