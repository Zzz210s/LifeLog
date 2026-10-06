#!/usr/bin/env node
/**
 * 关系图性能探针(只测量,不判定):同一套画布插桩上多包三件 —— 每帧的
 * `measureText` / `roundRect` / `setLineDash` / `getComputedStyle` 调用数。
 *
 * 读数:
 *   firstFrame  进图命令 -> 首个有内容的绘制(ms)
 *   idle3s      静止 3 秒的绘制帧数(设计口径:必须 0)
 *   zoom200     200 次滚轮缩放的帧间隔中位/p95/max + 每帧调用数中位
 *   pan200      200 次指针拖拽的帧间隔中位/p95/max + 每帧调用数中位
 *   hover60     60 次悬停移动(改强调态 -> 必然重建 plan 重绘)同上
 *   heap        进图后 JS 堆增量与进图前后差值
 * 用法:LIFELOG_CDP_PORT=9333 node scripts/graph-perf-probe.mjs [--json 输出路径]
 */
import { writeFileSync } from 'node:fs';
import { bindMain, ensureMain, sleep } from './cdp-lib.mjs';
import { bindUi } from './no-tabs-accept-lib.mjs';
import { armGraph, closeGraph, installPaintCounter, resetPaint, waitFirstDraw } from './graph-accept-lib.mjs';
import { installG3 } from './graph-accept-g3-lib.mjs';

const OUT = process.argv.find((a) => a.startsWith('--json='))?.slice(7) ?? null;
/** 可选:放大布局视口压测(--viewport=2400x1400),看绘制量随可见面积的增长 */
const VP = process.argv.find((a) => a.startsWith('--viewport='))?.slice(11) ?? null;
const VIEW = `document.querySelector('[data-testid="graph-view"]')`;
const r1 = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
const mb = (b) => Math.round((b / 1048576) * 10) / 10;

/** 页面侧插桩:每帧切一次(clearRect 起新帧),记这一帧的绘制调用与三个嫌疑计数 */
const installPerf = (cdp) => cdp.eval(`(() => {
  if (window.__gpV === 2) return true;
  const st = { frames: [], cur: null };
  const P = CanvasRenderingContext2D.prototype;
  const blank = () => ({ mt: 0, rr: 0, sld: 0, gcs: 0, fill: 0, stroke: 0, ft: 0 });
  const realClear = P.clearRect;
  P.clearRect = function (...a) {
    if (st.cur !== null) st.frames.push({ t: performance.now(), ...st.cur });
    st.cur = blank();
    return realClear.apply(this, a);
  };
  const bump = (k) => { if (st.cur !== null) st.cur[k] += 1; };
  const wrap = (name, key) => { const real = P[name]; P[name] = function (...a) { bump(key); return real.apply(this, a); }; };
  wrap('measureText', 'mt'); wrap('roundRect', 'rr'); wrap('setLineDash', 'sld');
  wrap('fill', 'fill'); wrap('stroke', 'stroke'); wrap('fillText', 'ft');
  const realGcs = window.getComputedStyle.bind(window);
  window.getComputedStyle = function (...a) { bump('gcs'); return realGcs(...a); };
  window.__gp = st;
  window.__gpReset = () => { st.frames = []; st.cur = blank(); return true; };
  window.__gpV = 2;
  return true;
})()`);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? null : s[s.length >> 1];
};
/** frames(带 t 的每帧记录)-> 帧间隔 + 每帧调用数中位 + 最慢三帧(带那一帧的调用数) */
function summarize(frames) {
  const gaps = frames.slice(1).map((f, i) => f.t - frames[i].t);
  const col = (k) => median(frames.map((f) => f[k]));
  const slowest = gaps
    .map((g, i) => ({ gap: r1(g), at: i + 1 }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 3)
    .map(({ gap, at }) => {
      const f = frames[at];
      return { gap, mt: f.mt, rr: f.rr, sld: f.sld, gcs: f.gcs, fill: f.fill, stroke: f.stroke, ft: f.ft };
    });
  return {
    frames: frames.length,
    median: r1(median(gaps)),
    p95: r1([...gaps].sort((a, b) => a - b)[Math.floor(gaps.length * 0.95)] ?? null),
    max: r1(gaps.length === 0 ? null : Math.max(...gaps)),
    slowest,
    perFrame: { mt: col('mt'), rr: col('rr'), sld: col('sld'), gcs: col('gcs'), fill: col('fill'), stroke: col('stroke'), ft: col('ft') },
  };
}
const readFrames = async (cdp) => summarize(await cdp.eval('window.__gp.frames'));

/** 一串合成事件逐帧跑:每步之间等一次 rAF(与 wheelFrames 同口径) */
const drive = (cdp, body, n) => cdp.eval(`(async () => {
  const el = ${VIEW};
  for (let i = 0; i < ${n}; i++) { ${body} await new Promise((r) => requestAnimationFrame(r)); }
  return true;
})()`);

const alive = await fetch(`http://127.0.0.1:${process.env.LIFELOG_CDP_PORT ?? 9222}/json/version`).then((r) => r.ok, () => false);
if (!alive) {
  console.error('需要先起应用(带远程调试端口的 dev 或装机版)');
  process.exit(2);
}
const conn = await ensureMain();
const ui = bindUi(conn.cdp);
const cdp = conn.cdp;
await installG3(cdp);
await installPerf(cdp);
await installPaintCounter(cdp);
if (VP !== null) {
  const [w, h] = VP.split('x').map(Number);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1.25, mobile: false });
  await sleep(1200);
}
await closeGraph(ui);
await sleep(800);

const heap0 = await cdp.send('Runtime.getHeapUsage');

// 1) 首帧(打点在 installPaintCounter 的绘制包装里,时间原点由 armGraph 盖)
await resetPaint(cdp);
const rows = await armGraph(ui);
const first = await waitFirstDraw(cdp);
await sleep(2000);
const heap1 = await cdp.send('Runtime.getHeapUsage');

// 2) 静止 3 秒
await cdp.eval('window.__gpReset()');
await sleep(3000);
const idle = await readFrames(cdp);

// 3) 缩放 200 帧
await cdp.eval('window.__gpReset()');
await drive(cdp, `el.dispatchEvent(new WheelEvent('wheel', { deltaY: i % 2 === 0 ? -120 : 120, clientX: 500, clientY: 350, bubbles: true, cancelable: true }));`, 200);
const zoom = await readFrames(cdp);

// 4) 平移 200 帧(先按 0 回适配档,再从左上角空白起手 —— 径向图四角是空的,起手点不压节点)
await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }))`);
await sleep(700);
await cdp.eval('window.__gpReset()');
await cdp.eval(`(() => {
  const el = ${VIEW};
  el.dispatchEvent(new PointerEvent('pointerdown', { clientX: 40, clientY: 60, bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  return true;
})()`);
await drive(cdp, `el.dispatchEvent(new PointerEvent('pointermove', { clientX: 40 + (i % 60), clientY: 60 + (i % 40), bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true }));`, 200);
await cdp.eval(`(() => {
  const el = ${VIEW};
  el.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 100, bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  return true;
})()`);
const pan = await readFrames(cdp);

// 5) 悬停移动 60 帧(改强调态,必然重建 plan)
await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }))`);
await sleep(700);
await cdp.eval('window.__gpReset()');
await drive(cdp, `el.dispatchEvent(new PointerEvent('pointermove', { clientX: 300 + i * 6, clientY: 250 + i * 4, bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true }));`, 60);
const hover = await readFrames(cdp);

const viewport = await cdp.eval('({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, canvas: (() => { const c = document.querySelector(\'[data-testid="graph-view"] canvas\'); return c === null ? null : { w: c.width, h: c.height }; })() })');
const out = {
  viewport,
  firstFrameMs: first.paintMs,
  mountMs: first.mountMs,
  rows: rows.length,
  heapDeltaMb: mb(heap1.usedSize - heap0.usedSize),
  heapBeforeMb: mb(heap0.usedSize),
  heapAfterMb: mb(heap1.usedSize),
  idleDraws3s: idle.frames,
  zoom,
  pan,
  hover,
};
console.log(JSON.stringify(out, null, 2));
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2));
conn.close();
process.exit(0);
