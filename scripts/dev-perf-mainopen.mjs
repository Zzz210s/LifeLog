#!/usr/bin/env node
/**
 * 主窗首开读数(任务 E 第 1 项):托盘「打开主窗口」-> 主窗可见 / 首帧渲染,以及首帧 JS 负担与侧栏刷新。
 *
 * 口径:
 *   主窗首开ms    win-tray.py pick 2 返回的 invoked_at(菜单项被选中的时刻,epoch ms)
 *                 -> 标题 LifeLog 的顶层窗口 IsWindowVisible 为真(dev-perf-winwatch.py 打点)
 *   首帧时间ms    主窗页面内 navigationStart -> first-contentful-paint(startTime,与墙钟无关)
 *   JS 负担       Performance.getMetrics 的 ScriptDuration/TaskDuration(自本次导航累计,ms)
 *   侧栏刷新      (a) list_tags IPC 往返 7 次中位;(b) 侧栏隐藏->显示重挂载 7 次中位
 *                 (重挂载 = buildTree(全量标签) + React 渲染整棵树;只读,不改任何笔记数据)
 * 每次运行都是全新启动(主窗 webview 是按需创建的,必须重启才能重测首开)。
 * 用法: node scripts/dev-perf-mainopen.mjs --label=baseline [--runs=3] [--sidebar=1] [--exe=路径]
 */
import { open, pages } from './cdp-lib.mjs';
import {
  OUT, SCRIPT, appWebviewProcs, killApp, killAppWebview, launch, sleep, stat, table, waitAppGone, waitUntil, watch, writeJson,
} from './dev-perf-lib.mjs';
import { spawnSync } from 'node:child_process';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const label = arg('label', 'baseline');
const runs = Number(arg('runs', '3'));
const doSidebar = arg('sidebar', '1') === '1';
const exe = arg('exe', 'E:/0-cargo-target/LifeLog/release/LifeLog.exe');
const DEBUG_ENV = { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9222' };

/** 主窗侧栏的只读打点:IPC 往返 + 「隐藏->显示」重挂载到 DOM 静默 */
const SIDEBAR_EXPR = `(async () => {
  const q = (s) => document.querySelector(s);
  const rows = () => document.querySelectorAll('[data-testid="tag-list"] [data-tag-path]').length;
  const until = async (fn, timeout = 2000) => {
    const t0 = performance.now();
    while (performance.now() - t0 < timeout) { if (fn()) return true; await new Promise((r) => setTimeout(r, 5)); }
    return false;
  };
  const ipc = [];
  for (let i = 0; i < 7; i++) {
    const t0 = performance.now();
    const list = await window.__TAURI_INTERNALS__.invoke('list_tags');
    ipc.push({ ms: Math.round((performance.now() - t0) * 100) / 100, rows: list.length });
  }
  const remount = [];
  for (let i = 0; i < 7; i++) {
    if (!q('[data-testid="sidebar"]')) { q('[aria-label="显示侧栏"]').click(); await until(() => q('[data-testid="sidebar"]')); }
    await new Promise((r) => setTimeout(r, 120));
    let lastMutation = 0;
    const obs = new MutationObserver(() => { lastMutation = performance.now(); });
    obs.observe(document.body, { childList: true, subtree: true });
    q('[aria-label="隐藏侧栏"]').click();
    if (!(await until(() => q('[aria-label="显示侧栏"]')))) break;
    const t0 = performance.now();
    q('[aria-label="显示侧栏"]').click();
    await until(() => q('[data-testid="sidebar"]'));
    const settle = await new Promise((res) => {
      const tick = () => {
        const t = performance.now();
        if (lastMutation > t0 && t - lastMutation > 60) res(true);
        else if (t - t0 > 3000) res(false);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    obs.disconnect();
    remount.push({ ms: lastMutation > t0 ? Math.round(lastMutation - t0) : null, rows: rows(), settle });
    await new Promise((r) => setTimeout(r, 150));
  }
  return { ipc, remount };
})()`;

/** 主窗页面内的首帧读数(paint/navigation 条目 + Performance 域累计指标 + 资源体积) */
const FIRSTFRAME_EXPR = `(() => {
  const paint = performance.getEntriesByType('paint');
  const at = (n) => { const e = paint.find((x) => x.name === n); return e ? Math.round(e.startTime * 10) / 10 : null; };
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const res = performance.getEntriesByType('resource')
    .filter((r) => /\\.(js|css)$/.test(r.name))
    .map((r) => ({ file: r.name.split('/').pop(), transfer: r.transferSize, decoded: r.decodedBodySize, ms: Math.round(r.duration) }));
  return { fcp: at('first-contentful-paint'), fp: at('first-paint'),
    dcl: Math.round(nav.domContentLoadedEventEnd || 0), load: Math.round(nav.loadEventEnd || 0),
    entries: performance.getEntriesByType('navigation').length, resources: res,
    readyState: document.readyState, tagRows: document.querySelectorAll('[data-testid="tag-list"] [data-tag-path]').length,
    noteItems: document.querySelectorAll('li .md-body').length };
})()`;

const metricOf = (metrics, name) => {
  const hit = metrics.find((m) => m.name === name);
  return hit ? Math.round(hit.value * 1000) : null;
};

function pickTray(pid) {
  const r = spawnSync('python', [SCRIPT('win-tray.py'), 'pick', String(pid), '2'], { encoding: 'utf8', windowsHide: true });
  try {
    return JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    return { ok: false, raw: r.stdout };
  }
}

async function oneRun(index) {
  killApp();
  await waitAppGone(10000);
  killAppWebview();
  await sleep(3500);
  const winW = watch(['win', '输入栏', '40000']);
  await winW.ready; // 观测器就绪后再启动,避免 python 冷启动拖后时间戳
  const { at: spawnAt } = launch(exe, DEBUG_ENV);
  const inputWin = await winW.done;
  if (!inputWin.pid) throw new Error('输入栏未出现,无法取 pid: ' + JSON.stringify(inputWin));
  const mainW = watch(['win', 'LifeLog', '40000']);
  await mainW.ready;
  const pick = pickTray(inputWin.pid);
  const mainWin = await mainW.done;
  mainW.kill();
  const mainOpenMs = mainWin.at && pick.invoked_at ? mainWin.at - pick.invoked_at : null;
  const targetMs = await waitUntil(async () => {
    try {
      return (await pages()).some((p) => !p.url.includes('input.html'));
    } catch {
      return false;
    }
  }, 15000, 25);
  const mp = await open('main');
  await mp.cdp.send('Performance.enable');
  const first = await mp.cdp.eval(FIRSTFRAME_EXPR);
  const metrics = (await mp.cdp.send('Performance.getMetrics')).metrics;
  const sample = {
    index,
    mainOpenMs,
    mainTargetMs: targetMs,
    connectError: null,
    firstFrame: first,
    scriptDurationMs: metricOf(metrics, 'ScriptDuration'),
    taskDurationMs: metricOf(metrics, 'TaskDuration'),
    layoutDurationMs: metricOf(metrics, 'LayoutDuration'),
    jsHeapKb: metricOf(metrics, 'JSHeapUsedSize'),
    wvRenderers: appWebviewProcs().filter((p) => p.kind === 'renderer').length,
    pickOk: pick.ok === true,
    trayVia: pick.via ?? null,
    spawnToInputMs: inputWin.at ? inputWin.at - spawnAt : null,
  };
  if (doSidebar && index === 0) {
    sample.sidebar = await mp.cdp.eval(SIDEBAR_EXPR);
  }
  mp.close();
  console.log(`INFO run#${index + 1}`, JSON.stringify({ mainOpenMs, mainTargetMs: targetMs,
    fcp: first.fcp, dcl: first.dcl, tags: first.tagRows, notes: first.noteItems,
    script: sample.scriptDurationMs, task: sample.taskDurationMs,
    wv: sample.wvRenderers, sidebar: sample.sidebar
      ? { ipcMedian: stat(sample.sidebar.ipc.map((x) => x.ms)).median,
          remountMedian: stat(sample.sidebar.remount.map((x) => x.ms).filter((v) => v !== null)).median }
      : null }));
  killApp();
  await waitAppGone(10000);
  return sample;
}

const samples = [];
for (let i = 0; i < runs; i++) samples.push(await oneRun(i));

const side = samples.find((s) => s.sidebar)?.sidebar ?? null;
const summary = {
  主窗首开中位: stat(samples.map((s) => s.mainOpenMs).filter((v) => v !== null)),
  主窗CDP目标中位: stat(samples.map((s) => s.mainTargetMs).filter((v) => v !== null)),
  FCP中位: stat(samples.map((s) => s.firstFrame.fcp).filter((v) => v !== null)),
  DCL中位: stat(samples.map((s) => s.firstFrame.dcl).filter((v) => v !== null)),
  ScriptDuration中位: stat(samples.map((s) => s.scriptDurationMs).filter((v) => v !== null)),
  TaskDuration中位: stat(samples.map((s) => s.taskDurationMs).filter((v) => v !== null)),
  侧栏IPC中位: side ? stat(side.ipc.map((x) => x.ms)).median : null,
  侧栏重挂载中位: side ? stat(side.remount.map((x) => x.ms).filter((v) => v !== null)).median : null,
  标签行数: side ? stat(side.remount.map((x) => x.rows)).max : null,
};
console.log('\n=== 主窗首开 ===');
table(['样本', '首开ms', 'FCPms', 'DCLms', 'ScriptDurationms', 'TaskDurationms', '标签行', '笔记条', 'JS资源KB'],
  samples.map((s, i) => [i + 1, s.mainOpenMs, s.firstFrame.fcp, s.firstFrame.dcl, s.scriptDurationMs, s.taskDurationMs,
    s.firstFrame.tagRows, s.firstFrame.noteItems,
    Math.round((s.firstFrame.resources || []).reduce((a, r) => a + (r.transfer || 0), 0) / 1024)]));
if (side) {
  console.log('\n=== 侧栏(只读打点) ===');
  table(['list_tags往返ms'], side.ipc.map((x) => [x.ms]));
  table(['重挂载ms', '渲染标签行'], side.remount.map((x) => [x.ms, x.rows]));
}
console.log('中位:', JSON.stringify(summary));
writeJson(`${label}-mainopen.json`, { label, exe, at: new Date().toISOString(), runs, samples, summary });
console.log('INFO 读数已落盘', `${OUT}/${label}-mainopen.json`);
