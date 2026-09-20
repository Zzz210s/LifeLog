#!/usr/bin/env node
/**
 * 主窗「首次打开」首帧 JS 负担(任务 E 第 2 项的判定依据):浏览器级 Target.setAutoAttach
 * + waitForDebuggerOnStart,在主窗 webview 真的从零加载之前插进打点脚本与 Profiler。
 *
 * 为什么不用 Page.navigate 重载(见 dev-perf-firstframe.mjs):重载吃 HTTP 缓存 + V8 code cache,
 * 会把解析/求值代价藏掉;首开路径(新建 webview、冷渲染器、冷 code cache)只能这样插桩。
 * 口径(navigationStart = 0):
 *   dclMs / fpMs / fcpMs  页面自身条目
 *   mountMs               注入脚本观测 #root 首次出现子节点(React 首次提交 = 首屏内容出现)
 *   jsMs                  从导航到 mountMs 期间的 Profiler 采样总耗时(采样间隔 50us)
 *   jsNativeMs/jsChunkMs  native 帧(V8 解析/编译/GC 等)与各 chunk 的 JS 帧归属
 * 用法: node scripts/dev-perf-firstopen.mjs --label=baseline [--runs=3] [--exe=路径]
 */
import { SCRIPT, appWebviewProcs, killApp, killAppWebview, launch, sleep, stat, table, waitAppGone, watch, writeJson } from './dev-perf-lib.mjs';
import { connectBrowser } from './dev-perf-browser-cdp.mjs';
import { spawnSync } from 'node:child_process';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const label = arg('label', 'baseline');
const runs = Number(arg('runs', '3'));
const exe = arg('exe', 'E:/0-cargo-target/LifeLog/release/LifeLog.exe');
const DEBUG_ENV = { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9222' };
const SAMPLE_US = 50;
// --wait-start:暂停在导航前再插桩(JS 归属最纯净,但会把页面计时拖后 600ms 左右);
// 默认不暂停:首开计时保持真实(与 dev-perf-mainopen.mjs 的读数同口径),插桩靠「目标刚建就挂」抢时机。
const WAIT_START = process.argv.includes('--wait-start');

const INJECT = `(() => {
  window.__perf = { start: performance.now(), mountAt: null, firstNoteAt: null, longTasks: 0, longTaskMs: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { window.__perf.longTasks += 1; window.__perf.longTaskMs += e.duration; }
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) { /* 无 longtask 支持则跳过 */ }
  const once = (get, key) => { if (get() && window.__perf[key] === null) window.__perf[key] = performance.now(); };
  const tick = () => {
    once(() => { const r = document.getElementById('root'); return !!(r && r.childElementCount > 0); }, 'mountAt');
    once(() => !!document.querySelector('li .md-body'), 'firstNoteAt');
  };
  tick();
  const t = setInterval(() => { tick(); if (window.__perf.mountAt && window.__perf.firstNoteAt) clearInterval(t); }, 5);
})()`;

const READ = `(() => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const paint = performance.getEntriesByType('paint');
  const at = (n) => { const e = paint.find((x) => x.name === n); return e ? Math.round(e.startTime * 10) / 10 : null; };
  const res = performance.getEntriesByType('resource').filter((r) => /\\.(js|css)$/.test(r.name))
    .map((r) => ({ file: r.name.split('/').pop(), end: Math.round(r.responseEnd * 10) / 10, decoded: r.decodedBodySize }));
  return { mountAt: (window.__perf || {}).mountAt == null ? null : Math.round(window.__perf.mountAt * 10) / 10,
    firstNoteAt: (window.__perf || {}).firstNoteAt == null ? null : Math.round(window.__perf.firstNoteAt * 10) / 10,
    longTaskMs: Math.round(((window.__perf || {}).longTaskMs || 0) * 10) / 10, fp: at('first-paint'), fcp: at('first-contentful-paint'),
    dcl: Math.round(nav.domContentLoadedEventEnd * 10) / 10,
    fetchMs: Math.round(Math.max(0, ...res.map((r) => r.end)) * 10) / 10,
    resources: res, noteItems: document.querySelectorAll('li .md-body').length,
    tagRows: document.querySelectorAll('[data-testid="tag-list"] [data-tag-path]').length };
})()`;

function profileSplit(profile) {
  let hits = 0;
  const byChunk = {};
  for (const n of profile.nodes) {
    hits += n.hitCount;
    const url = n.callFrame.url || '';
    if (!url) byChunk.native = Math.round((byChunk.native || 0) + n.hitCount);
    else byChunk[url.split('/').pop()] = Math.round((byChunk[url.split('/').pop()] || 0) + n.hitCount);
  }
  const toMs = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * SAMPLE_US) / 1000]));
  return { jsMs: Math.round(hits * SAMPLE_US) / 1000, byChunk: toMs(byChunk), nodes: profile.nodes.length };
}

async function oneRun(index) {
  killApp();
  await waitAppGone(10000);
  killAppWebview();
  await sleep(3000);
  const winW = watch(['win', '输入栏', '40000']);
  await winW.ready;
  launch(exe, DEBUG_ENV);
  const inputWin = await winW.done;
  if (!inputWin.pid) throw new Error('输入栏未出现');
  const { bc, close: closeBrowser } = await connectBrowser();
  const dbg = process.argv.includes('--debug');
  if (dbg) bc.handlers.push((m) => console.log('EV', m.method, JSON.stringify(m.params?.targetInfo ?? m.params?.sessionId ?? '').slice(0, 160)));
  await bc.send('Target.setDiscoverTargets', { discover: true });
  await bc.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: WAIT_START, flatten: true });
  let session = null;
  let picked = null;
  bc.handlers.push(async (m) => {
    if (m.method !== 'Target.attachedToTarget' || session) return;
    const info = m.params.targetInfo;
    // 主窗目标出现时 URL 还是空的(随后从 about:blank 导航到 http://tauri.localhost/),
    // 所以按「是 page 且不是输入栏」认领;输入栏在我们 setAutoAttach 之前就已存在,不会被认错。
    if (info.type !== 'page' || info.url.includes('input.html')) return;
    session = m.params.sessionId;
    picked = info.url;
    await bc.send('Page.enable', {}, session);
    await bc.send('Profiler.enable', {}, session);
    await bc.send('Profiler.setSamplingInterval', { interval: SAMPLE_US }, session);
    await bc.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT }, session);
    await bc.send('Profiler.start', {}, session);
    if (WAIT_START) await bc.send('Runtime.runIfWaitingForDebugger', {}, session);
  });
  const mainW = watch(['win', 'LifeLog', '40000']);
  await mainW.ready;
  const pick = JSON.parse(spawnSync('python', [SCRIPT('win-tray.py'), 'pick', String(inputWin.pid), '2'],
    { encoding: 'utf8', windowsHide: true }).stdout.trim().split('\n').pop());
  const mainWin = await mainW.done;
  mainW.kill();
  const t0 = Date.now();
  let read = null;
  // 同一个循环里等两件事:主窗目标被自动附加(session 出现)→ 页面里 mountAt 落点
  while (Date.now() - t0 < 25000) {
    if (session) {
      try {
        const v = await bc.send('Runtime.evaluate', { expression: READ, returnByValue: true }, session);
        const val = v.result.value;
        if (val && (val.firstNoteAt !== null || (val.noteItems || 0) > 0)) {
          read = val;
          break;
        }
      } catch { /* 上下文尚未就绪/正在导航 */ }
    }
    await sleep(25);
  }
  const prof = session ? await bc.send('Profiler.stop', {}, session) : { profile: { nodes: [] } };
  closeBrowser();
  const sample = {
    index, picked, sessionFound: !!session, waitStart: WAIT_START,
    mainOpenMs: mainWin.at && pick.invoked_at ? mainWin.at - pick.invoked_at : null,
    ...(read || { mountAt: null, fcp: null, dcl: null }),
    waitedMs: Date.now() - t0,
    ...profileSplit(prof.profile),
  };
  delete sample.resources;
  console.log(`INFO run#${index + 1}`, JSON.stringify(sample));
  killApp();
  await waitAppGone(10000);
  return sample;
}

const samples = [];
for (let i = 0; i < runs; i++) samples.push(await oneRun(i));
const col = (f) => samples.map(f).filter((v) => v !== null && v !== undefined);
const chunks = [...new Set(samples.flatMap((s) => Object.keys(s.byChunk || {})))];
const summary = {
  主窗首开中位: stat(col((s) => s.mainOpenMs)),
  dclMs: stat(col((s) => s.dclMs)), fpMs: stat(col((s) => s.fp)),
  首屏提交mountMs: stat(col((s) => s.mountAt)), fcpMs: stat(col((s) => s.fcp)),
  首帧JS总中位: stat(col((s) => s.jsMs)),
  按chunk中位: Object.fromEntries(chunks.map((c) => [c, stat(col((s) => s.byChunk[c]))])),
  longTaskMs: stat(col((s) => s.longTaskMs)),
};
console.log('\n=== 主窗首次打开(自动附加插桩' + (WAIT_START ? ',导航前暂停' : '') + ') ===');
table(['样本', '首开ms', 'DCLms', 'FPms', '首屏提交ms', '首帧内容ms', 'FCPms', '首帧JSms', 'longTaskms'],
  samples.map((s, i) => [i + 1, s.mainOpenMs, s.dclMs, s.fp, s.mountAt, s.firstNoteAt, s.fcp, s.jsMs, s.longTaskMs]));
table(['chunk', '首帧JS中位ms'], Object.entries(summary.按chunk中位).map(([k, v]) => [k, v.median]));
console.log('中位:', JSON.stringify(summary));
writeJson(`${label}-firstopen${WAIT_START ? '-waitstart' : ''}.json`, { label, exe, at: new Date().toISOString(), runs, waitStart: WAIT_START, samples, summary });
console.log('INFO 读数已落盘 .superpowers/perf/', `${label}-firstopen${WAIT_START ? '-waitstart' : ''}.json`, 'leakedWv', appWebviewProcs().length);
