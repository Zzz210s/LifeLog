#!/usr/bin/env node
/**
 * 主窗首帧 JS 负担(任务 E 第 1/2 项的关键读数):用「可插桩的重载」把首帧拆成可对照的分段。
 *
 * 为什么用重载口径:主窗 webview 是按需创建的,CDP 只能在它出现之后连上,插不进「导航前」;
 * 但主窗加载路径(同一 index.html + 同一份 dist 资源 + 同一后端数据)在 Page.navigate 重载时
 * 完全一致,而重载前可以 Page.addScriptToEvaluateOnNewDocument 注入打点脚本 + Profiler.start(),
 * 于是能拿到真实的首帧分段与「每个 chunk 各自吃掉多少 JS 时间」。改动前后同口径重测即可对比。
 *
 * 分段(都以 navigationStart 为 0):
 *   fetchMs    最晚完成的 js/css 资源 responseEnd(网络/解码,不含执行)
 *   dclMs      DOMContentLoaded(module 脚本执行完才算,所以 JS 解析+求值在这之前)
 *   mountMs    注入脚本观测到的 #root 首次出现子节点(React 首次提交)
 *   fcpMs      first-contentful-paint
 *   jsTotalMs  Profiler 采样估计的总 JS 自耗时(采样间隔 50us × hitCount)
 *   jsByUrl    按 chunk 归属的 JS 自耗时(定位「哪块包最贵」)
 * 用法: node scripts/dev-perf-firstframe.mjs --label=baseline [--runs=5] [--exe=路径]
 */
import { open, waitFor } from './cdp-lib.mjs';
import { SCRIPT, appPids, killApp, killAppWebview, launch, sleep, stat, table, waitAppGone, watch, writeJson } from './dev-perf-lib.mjs';
import { spawnSync } from 'node:child_process';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const label = arg('label', 'baseline');
const runs = Number(arg('runs', '5'));
const exe = arg('exe', 'E:/0-cargo-target/LifeLog/release/LifeLog.exe');
const DEBUG_ENV = { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9222' };
const SAMPLE_US = 50; // Profiler 采样间隔(微秒),越小越准但样本越贵

/** 导航前注入:document start 标记 + longtask 累加 + #root 首次提交打点 */
const INJECT = `(() => {
  window.__perf = { start: performance.now(), mountAt: null, longTasks: 0, longTaskMs: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { window.__perf.longTasks += 1; window.__perf.longTaskMs += e.duration; }
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) { /* 不支持 longtask 就不测这一项 */ }
  const check = () => {
    const root = document.getElementById('root');
    if (root && root.childElementCount > 0) { window.__perf.mountAt = performance.now(); return true; }
    return false;
  };
  if (!check()) {
    const timer = setInterval(() => { if (check()) clearInterval(timer); }, 1);
  }
})()`;

const READ = `(() => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const paint = performance.getEntriesByType('paint');
  const at = (n) => { const e = paint.find((x) => x.name === n); return e ? Math.round(e.startTime * 10) / 10 : null; };
  const res = performance.getEntriesByType('resource')
    .filter((r) => /\\.(js|css)$/.test(r.name))
    .map((r) => ({ file: r.name.split('/').pop(), start: Math.round(r.startTime * 10) / 10,
      end: Math.round(r.responseEnd * 10) / 10, decoded: r.decodedBodySize }));
  return { perf: window.__perf, fp: at('first-paint'), fcp: at('first-contentful-paint'),
    dcl: Math.round(nav.domContentLoadedEventEnd * 10) / 10, load: Math.round(nav.loadEventEnd * 10) / 10,
    resources: res, readyState: document.readyState,
    tagRows: document.querySelectorAll('[data-testid="tag-list"] [data-tag-path]').length,
    noteItems: document.querySelectorAll('li .md-body').length };
})()`;

/** Profiler 采样结果按 callFrame.url 归总自耗时(ms);fn 名可能被压缩,靠 url 归属 */
function byUrl(profile, intervalMs) {
  const urlOf = new Map(profile.nodes.map((n) => [n.id, n.callFrame.url || '(匿名)']));
  const out = {};
  for (const n of profile.nodes) {
    const url = urlOf.get(n.id) || '(匿名)';
    const key = url === '' ? '(页面内联)' : url.split('/').pop();
    out[key] = Math.round((out[key] || 0) + n.hitCount * intervalMs);
  }
  return out;
}

async function bootApp() {
  killApp();
  await waitAppGone(10000);
  killAppWebview();
  await sleep(2500);
  const winW = watch(['win', '输入栏', '40000']);
  await winW.ready;
  launch(exe, DEBUG_ENV);
  const inputWin = await winW.done;
  if (!inputWin.pid) throw new Error('输入栏未出现');
  const mainW = watch(['win', 'LifeLog', '40000']);
  await mainW.ready;
  const r = spawnSync('python', [SCRIPT('win-tray.py'), 'pick', String(inputWin.pid), '2'], { encoding: 'utf8', windowsHide: true });
  const pick = JSON.parse(r.stdout.trim().split('\n').pop());
  const mainWin = await mainW.done;
  mainW.kill();
  return { inputWin, pick, mainWin };
}

const { mainWin, pick } = await bootApp();
console.log('INFO 主窗已开', JSON.stringify({ openMs: mainWin.at - pick.invoked_at, pid: mainWin.pid }));
const mp = await open('main');
const target = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter((p) => p.type === 'page')
  .find((p) => !p.url.includes('input.html'));
const pageUrl = target.url.split('#')[0];
await mp.cdp.send('Page.enable');
await mp.cdp.send('Profiler.enable');
await mp.cdp.send('Profiler.setSamplingInterval', { interval: SAMPLE_US });
await mp.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });

const samples = [];
for (let i = 0; i < runs; i++) {
  await mp.cdp.send('Profiler.start');
  const t0 = Date.now();
  await mp.cdp.send('Page.navigate', { url: pageUrl });
  const settled = await waitFor(async () => {
    try {
      const v = await mp.cdp.eval('window.__perf && window.__perf.mountAt ? 1 : 0');
      return v ? true : null;
    } catch {
      return null;
    }
  }, 60, 50);
  const read = await mp.cdp.eval(READ);
  const { profile } = await mp.cdp.send('Profiler.stop');
  const jsByUrl = byUrl(profile, SAMPLE_US / 1000);
  const jsTotalMs = Object.values(jsByUrl).reduce((a, b) => a + b, 0);
  const fetchMs = Math.max(...read.resources.map((r) => r.end), 0);
  const dclMs = read.dcl;
  const mountMs = read.perf.mountAt === null ? null : Math.round(read.perf.mountAt * 10) / 10;
  const sample = {
    index: i, settled: !!settled, navigateMs: Date.now() - t0,
    fetchMs, dclMs, mountMs, fcpMs: read.fcp, fpMs: read.fp,
    jsTotalMs, jsByUrl,
    jsEvalMs: dclMs === null ? null : Math.round((dclMs - fetchMs) * 10) / 10,
    reactAndDataMs: mountMs === null ? null : Math.round((mountMs - dclMs) * 10) / 10,
    longTaskMs: Math.round(read.perf.longTaskMs * 10) / 10,
    tagRows: read.tagRows, noteItems: read.noteItems,
    chunkKb: read.resources.filter((r) => r.file.endsWith('.js')).map((r) => r.file.replace(/-\w+\.js$/, '') + ':' + Math.round(r.decoded / 1024)),
  };
  samples.push(sample);
  console.log(`INFO run#${i + 1}`, JSON.stringify(sample));
  await sleep(600);
}
mp.close();
killApp();
await waitAppGone(10000);

const col = (f) => samples.map(f).filter((v) => v !== null && v !== undefined);
const summary = {
  fetchMs: stat(col((s) => s.fetchMs)), dclMs: stat(col((s) => s.dclMs)), mountMs: stat(col((s) => s.mountMs)),
  fcpMs: stat(col((s) => s.fcpMs)), jsTotalMs: stat(col((s) => s.jsTotalMs)),
  jsEvalMs: stat(col((s) => s.jsEvalMs)), reactAndDataMs: stat(col((s) => s.reactAndDataMs)),
  longTaskMs: stat(col((s) => s.longTaskMs)),
  jsByUrl中位: Object.fromEntries(Object.keys(samples[0].jsByUrl).map((k) => [k, stat(col((s) => s.jsByUrl[k])).median])),
};
console.log('\n=== 主窗重载首帧(同口径) ===');
table(['样本', '资源完成ms', 'DCLms', '首帧FCPms', 'React提交ms', 'JS总ms', 'JS求值ms', '数据+渲染ms', 'longTaskms'],
  samples.map((s, i) => [i + 1, s.fetchMs, s.dclMs, s.fcpMs, s.mountMs, s.jsTotalMs, s.jsEvalMs, s.reactAndDataMs, s.longTaskMs]));
table(['chunk', 'JS中位ms'], Object.entries(summary.jsByUrl中位).map(([k, v]) => [k, v]));
console.log('中位:', JSON.stringify(summary));
writeJson(`${label}-firstframe.json`, { label, exe, at: new Date().toISOString(), runs, pageUrl, samples, summary });
console.log('INFO 读数已落盘 .superpowers/perf/', `${label}-firstframe.json`, 'appPids', appPids().length);
