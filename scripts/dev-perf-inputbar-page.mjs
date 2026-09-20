// 输入栏启动性能测量共用的页面内表达式、页面侧读数与 Profiler 归因(见 dev-perf-inputbar.mjs)。
import { pages } from './cdp-lib.mjs';
import { sleep, waitUntil } from './dev-perf-lib.mjs';

/** 产品侧打点名(src/input-bar/use-input-settings.ts):设置状态已落到 React 状态 */
export const SETTINGS_MARK = 'lifelog-input-settings-applied';
/** 产品侧打点名:置顶 setAlwaysOnTop 的 IPC 往返也已完成 */
export const AOT_MARK = 'lifelog-input-always-on-top-applied';

/** 导航前注入:longtask 累加(可选,不支持就跳过,不影响其他读数) */
export const INJECT = `(() => {
  window.__perf = { longTasks: 0, longTaskMs: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { window.__perf.longTasks += 1; window.__perf.longTaskMs += e.duration; }
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) { /* 不支持 longtask 就不测这一项 */ }
})()`;

/**
 * 页面内读数。timeOrigin 是 epoch 毫秒,可与其他来源(进程创建、窗口首次可见)对齐到同一条时间轴;
 * fp/settingsApplied 等既给「相对 timeOrigin」也给 epoch,避免再来回换算。
 */
export const READ = `(() => {
  const paint = performance.getEntriesByType('paint');
  const at = (n) => { const e = paint.find((x) => x.name === n); return e ? Math.round(e.startTime * 10) / 10 : null; };
  const markAt = (n) => { const e = performance.getEntriesByName(n, 'mark')[0]; return e ? Math.round(e.startTime * 10) / 10 : null; };
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const res = performance.getEntriesByType('resource')
    .filter((r) => /\\.(js|css)$/.test(r.name))
    .map((r) => ({ file: r.name.split('/').pop(), initiator: r.initiatorType, transfer: r.transferSize,
      decoded: r.decodedBodySize, start: Math.round(r.startTime * 10) / 10, end: Math.round(r.responseEnd * 10) / 10 }));
  const perf = (window.__perf || {});
  return { timeOrigin: performance.timeOrigin, fp: at('first-paint'), fcp: at('first-contentful-paint'),
    dcl: Math.round((nav.domContentLoadedEventEnd || 0) * 10) / 10,
    loadEnd: Math.round((nav.loadEventEnd || 0) * 10) / 10,
    settingsApplied: markAt('${SETTINGS_MARK}'), aotApplied: markAt('${AOT_MARK}'),
    settingsFailed: markAt('lifelog-input-settings-failed'),
    rootChildren: (document.getElementById('root') || { childElementCount: 0 }).childElementCount,
    longTasks: perf.longTasks ?? null, longTaskMs: perf.longTaskMs === undefined ? null : Math.round(perf.longTaskMs * 10) / 10,
    readyState: document.readyState, res };
})()`;

/** 等输入栏 CDP 目标出现;返回是否出现 */
export async function waitInputTarget(timeoutMs = 25000) {
  return (await waitUntil(async () => {
    try {
      return (await pages()).some((p) => p.url.includes('input.html'));
    } catch {
      return false;
    }
  }, timeoutMs, 25)) !== null;
}

/** 连上输入栏读页面内读数:首帧与打点可能晚于 CDP 连接,读不到就轮询 */
export async function readPage(cdp, tries = 60) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    last = await cdp.eval(READ);
    if (last && last.fp !== null && (last.settingsApplied !== null || last.settingsFailed !== null)) return last;
    await sleep(50);
  }
  return last;
}

/** 页面生命周期累计计数(Performance.getMetrics):ScriptDuration 是导航以来 JS 执行总时长 */
export async function pageMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const get = (name) => metrics.find((m) => m.name === name)?.value ?? null;
  const s = (v) => (v === null ? null : Math.round(v * 1000));
  return { scriptMs: s(get('ScriptDuration')), taskMs: s(get('TaskDuration')),
    layoutMs: s(get('LayoutDuration')), styleMs: s(get('RecalcStyleDuration')),
    heapMb: get('JSHeapUsedSize') === null ? null : Math.round(get('JSHeapUsedSize') / 1048576) };
}

/** 把 Profiler 采样按 callFrame.url 归总自耗时(ms);函数名被压缩,只能靠 url 归属到 chunk */
export function byUrl(profile, intervalMs) {
  const out = {};
  for (const n of profile.nodes) {
    const url = n.callFrame.url;
    const key = !url ? '(页面内联)' : url.split('/').pop();
    out[key] = Math.round((out[key] || 0) + n.hitCount * intervalMs);
  }
  return out;
}

/** 大块判定:启动资源里 decoded 最大者(基线即 200KB+ 的 react-dom 所在共享 chunk) */
export function flagLargest(resources) {
  let top = null;
  for (const r of resources || []) if (!top || r.decoded > top.decoded) top = r;
  return top ? top.file : null;
}
