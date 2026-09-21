// 滚动测量 E 节:滚动性能(50 条流 / 602 标签侧栏各一次)。
// 采:Performance.getMetrics 前后差值、rAF 帧间隔中位/最大、长任务(>50ms)次数、
//     MutationObserver 的 DOM 变更数(React 重渲染的代理指标)。
// 用法:node scripts/dev-scroll-e.mjs
import { writeFileSync } from 'node:fs';
import { main, install, js, one, findSel, rect, wheel, sleep, reloadPage, dump } from './dev-scroll-lib.mjs';

const OUT = '.superpowers/sdd/2026-09-21-scroll/readings/E-perf.json';
const STREAM = `(() => { const el = document.querySelector('.md-body'); return el ? el.closest('div[class*=overflow-y-auto]') : null; })()`;
const R = {};

const METRICS = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount', 'JSHeapUsedSize'];

async function metrics(cdp) {
  const out = {};
  for (const m of (await cdp.send('Performance.getMetrics')).metrics) if (METRICS.includes(m.name)) out[m.name] = m.value;
  return out;
}

const INSTRUMENT = (expr) => `(() => {
  window.__perf && window.__perf.mo && window.__perf.mo.disconnect();
  const target = (${expr});
  const P = { frames: [], muts: 0, long: [], raf: 0, t0: 0 };
  const loop = (t) => { P.frames.push(t); P.raf = requestAnimationFrame(loop); };
  P.raf = requestAnimationFrame(loop);
  P.mo = new MutationObserver((rs) => { P.muts += rs.length; });
  P.mo.observe(target, { childList: true, subtree: true, attributes: true, characterData: true });
  try {
    P.po = new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push(Math.round(e.duration)); });
    P.po.observe({ entryTypes: ['longtask'] });
  } catch (e) { P.longErr = String(e); }
  window.__perf = P;
  return true;
})()`;

async function drive(cdp, point, steps, delta) {
  for (let i = 0; i < steps; i++) {
    await wheel(cdp, point.x, point.y, delta);
    await sleep(28);
  }
  await sleep(500);
  return js(cdp, `(() => {
    const P = window.__perf;
    const gaps = P.frames.slice(1).map((t, i) => t - P.frames[i]).filter((g) => g > 0);
    const sorted = [...gaps].sort((a, b) => a - b);
    const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
    const out = {
      帧数: gaps.length,
      帧间隔中位ms: med === null ? null : Math.round(med * 100) / 100,
      帧间隔最大ms: sorted.length ? Math.round(sorted[sorted.length - 1] * 100) / 100 : null,
      帧间隔P95ms: sorted.length ? Math.round(sorted[Math.floor(sorted.length * 0.95)] * 100) / 100 : null,
      超50ms帧间隔数: sorted.filter((g) => g > 50).length,
      长任务: P.long, 长任务次数: P.long.length, 最长任务ms: P.long.length ? Math.max(...P.long) : null,
      DOM变更数: P.muts,
      longErr: P.longErr ?? null,
    };
    P.mo.disconnect(); cancelAnimationFrame(P.raf);
    return out;
  })()`);
}

const { cdp, close } = await main();
await install(cdp);
await cdp.send('Performance.enable');
await reloadPage(cdp);
await sleep(600);

async function run(label, sel, note) {
  const q = `document.querySelector(${JSON.stringify(sel)})`;
  const info = await one(cdp, sel);
  const r = await rect(cdp, sel);
  const p = { x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h * 0.35) };
  await js(cdp, `(() => { const el = (${q}); el.scrollTop = 0; return true; })()`);
  await sleep(400);
  await js(cdp, INSTRUMENT(q));
  await sleep(300);
  const before = await metrics(cdp);
  const notesBefore = await js(cdp, `document.querySelectorAll('li .md-body').length`);
  const frames = await drive(cdp, p, 20, 250);
  const after = await metrics(cdp);
  const notesAfter = await js(cdp, `document.querySelectorAll('li .md-body').length`);
  const diff = {};
  for (const k of METRICS) diff[k] = Math.round((after[k] - before[k]) * 1000) / 1000;
  const scrolled = await js(cdp, `(() => { const el = (${q}); return { top: Math.round(el.scrollTop), max: el.scrollHeight - el.clientHeight }; })()`);
  return { label, note, 容器: { cw: info.cw, ch: info.ch, sh: info.sh }, 落点: p, 滚动结果: scrolled, 条目数: { 前: notesBefore, 后: notesAfter }, 指标差值: diff, ...frames };
}

const streamSel = await findSel(cdp, STREAM);
const tagSel = await findSel(cdp, `document.querySelector('[data-testid="tag-list"]')`);
R.笔记流 = await run('笔记流@50条', streamSel, '20 次 mouseWheel(每次 250 CSS px,间隔 28ms)');
R.侧栏标签区 = await run('侧栏标签区@602标签', tagSel, '20 次 mouseWheel(每次 250 CSS px,间隔 28ms)');
writeFileSync(OUT, JSON.stringify(R, null, 2));
dump('E 节', R);
console.log('\n写入', OUT);
close();
