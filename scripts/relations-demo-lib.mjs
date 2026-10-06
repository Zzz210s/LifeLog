// 关系备注演示(scripts/dev-relations-demo.mjs)的共用件:页面探针 / 截图 / 相机对准。
// 判定与流程留在主脚本(与其它 accept-lib 同风格);这里只做「装探针 / 读画布 / 发事件 / 存 PNG」。
import { writeFileSync } from 'node:fs';

export const NS = '关系演示';
export const ROOT = NS;
export const CHILD_PLAIN = `${NS}/属性`;
export const CHILD_MD = `[属性](箭头上的备注文字)`;
export const CHILD_MD_PATH = `${NS}/${CHILD_MD}`;
export const REMARK = '箭头上的备注文字';
export const SOURCE = '作者/丸尾常喜';
export const NOTE = `${NS}锚笔记`;
export const SHOTS = '.superpowers/shots';
export const SH = (n) => `${SHOTS}/relations-demo-${n}.png`;

/** 页面探针:记录各自路径的 fillText 坐标(关系备注)与 fill 圆(找空白点用) */
export const installProbe = (cdp) =>
  cdp.eval(`(() => {
    if (window.__markV === 1) return true;
    const P = CanvasRenderingContext2D.prototype;
    const real = { clear: P.clearRect, begin: P.beginPath, arc: P.arc, fill: P.fill, text: P.fillText };
    let cur = { texts: [], dots: [] }, ring = null;
    const mine = (c) => c.canvas && c.canvas.closest && !!c.canvas.closest('[data-testid="graph-view"]');
    P.clearRect = function (...a) { if (mine(this)) cur = { texts: [], dots: [] }; return real.clear.apply(this, a); };
    P.beginPath = function (...a) { ring = null; return real.begin.apply(this, a); };
    P.arc = function (x, y, r, ...a) { if (mine(this)) ring = { x, y, r }; return real.arc.call(this, x, y, r, ...a); };
    P.fill = function (...a) { if (mine(this) && ring) { cur.dots.push(ring); ring = null; } return real.fill.apply(this, a); };
    P.fillText = function (t, x, y, ...a) { if (mine(this)) cur.texts.push({ t: String(t), x, y }); return real.text.call(this, t, x, y, ...a); };
    window.__mark = { get: () => cur }; window.__markV = 1; return true;
  })()`);

export const probe = (cdp) => cdp.eval('window.__mark ? window.__mark.get() : null');
export const markOf = async (cdp, text) => ((await probe(cdp))?.texts ?? []).find((m) => m.t === text) ?? null;
export const canvasBox = (cdp) =>
  cdp.eval(`(() => { const c = document.querySelector('[data-testid="graph-view"] canvas'); if (!c) return null;
    const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, w: c.clientWidth, h: c.clientHeight }; })()`);
/** 页面侧选择器片段:`'[data-tag-path=' + JSON.stringify("…") + ']'` */
export const rowSel = (path) => `'[data-tag-path=' + JSON.stringify(${JSON.stringify(path)}) + ']'`;

/** 画布上离所有填充圆最远的候选点(拖拽起点落在空白处才是平移,不是拖节点) */
export const emptyPoint = async (cdp) => {
  const f = await probe(cdp);
  const b = await canvasBox(cdp);
  if (!b) return null;
  let best = null;
  for (const fx of [0.15, 0.3, 0.5, 0.7, 0.85]) for (const fy of [0.15, 0.3, 0.5, 0.7, 0.85]) {
    const c = { x: fx * b.w, y: fy * b.h };
    const d = (f?.dots ?? []).reduce((m, q) => Math.min(m, Math.hypot(q.x - c.x, q.y - c.y) - q.r), Infinity);
    if (best === null || d > best.d) best = { ...c, d };
  }
  return best;
};

/** 合成指针拖拽(容器上挂着 onPointerX):把内容沿 (dx,dy) 平移 */
export const panBy = (cdp, fx, fy, dx, dy) =>
  cdp.eval(`(() => { const el = document.querySelector('[data-testid="graph-view"]');
    const c = el.querySelector('canvas'); const r = c.getBoundingClientRect();
    const mk = (t, x, y) => new PointerEvent(t, { clientX: r.left + x, clientY: r.top + y, bubbles: true, pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0 });
    el.dispatchEvent(mk('pointerdown', ${fx}, ${fy}));
    for (let i = 1; i <= 4; i++) el.dispatchEvent(mk('pointermove', ${fx} + ${dx} * i / 4, ${fy} + ${dy} * i / 4));
    el.dispatchEvent(mk('pointerup', ${fx} + ${dx}, ${fy} + ${dy}));
    return true; })()`);

/** 以画布中心为锚点连发滚轮放大(delta < 0) */
export const zoomBy = (cdp, ticks) =>
  cdp.eval(`(async () => { const el = document.querySelector('[data-testid="graph-view"]');
    const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    for (let i = 0; i < ${ticks}; i++) { el.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      await new Promise((res) => requestAnimationFrame(res)); }
    return true; })()`);

/** 截图存文件;clip 为视口 CSS 像素矩形,scale > 1 得到放大图(读底衬细节用) */
export const shot = async (cdp, file, clip, scale = 1) => {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, ...(clip ? { clip: { ...clip, scale } } : {}) });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
};

/** 把备注文字挪到画布中心:读实际坐标 → 拖空白平移 → 复测(方向反了自动翻转) */
export async function centerOnMark(cdp, text, log) {
  let sign = 1, prev = Infinity;
  for (let i = 0; i < 6; i++) {
    const m = await markOf(cdp, text);
    const b = await canvasBox(cdp);
    if (!m || !b) return null;
    const err = { x: b.w / 2 - m.x, y: b.h / 2 - m.y };
    const d = Math.hypot(err.x, err.y);
    log(`  居中第 ${i + 1} 轮:备注(${Math.round(m.x)},${Math.round(m.y)}) 偏差 ${Math.round(d)}`);
    if (d < 40) return { x: m.x, y: m.y, d: Math.round(d) };
    if (d > prev) sign = -sign;
    prev = d;
    const start = await emptyPoint(cdp);
    if (!start || !(start.d > 12)) { log(`  空白起点太近(${start ? Math.round(start.d) : 'n/a'}),放弃居中`); return { x: m.x, y: m.y }; }
    await panBy(cdp, start.x, start.y, sign * err.x, sign * err.y);
    await new Promise((r) => setTimeout(r, 320));
  }
  const m = await markOf(cdp, text);
  return m ? { x: m.x, y: m.y } : null;
}
