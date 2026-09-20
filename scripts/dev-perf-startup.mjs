#!/usr/bin/env node
/**
 * 启动耗时读数(任务 E 第 1 项):进程创建 -> 输入栏窗口可见,冷/暖两态各 N 次取中位 + WebView2 分解。
 *
 * 口径(t0 都是「LifeLog.exe 进程对象出现时刻」,由 dev-perf-winwatch.py 按 kernel32 读数打点):
 *   进程出现   spawn -> Process32 首次枚举到该 exe
 *   输入栏可见 进程出现 -> 标题「输入栏」的顶层窗口 IsWindowVisible 为真(winwatch 轮询 2-3ms)
 *   CDP 目标    进程出现 -> 9222 的 /json/list 出现 input.html(可比读数,不作验收口径)
 *   WebView2    进程出现 -> 该应用的 msedgewebview2.exe 各类进程 CreationDate(浏览器/渲染器)
 * 冷/暖定义:冷 = 先杀掉本应用的 WebView2 进程再等 4s(进程冷);
 *   暖 = 上一次运行刚退出、立刻再启动。真·系统级冷启动(重启后首次)本机不可造 —— 报告里标注。
 * 前置:不要有别的 LifeLog 实例在跑(单实例会让新进程静默退出)。
 * 用法: node scripts/dev-perf-startup.mjs --label=baseline [--runs=3] [--mode=cold,warm] [--exe=路径]
 */
import { pages } from './cdp-lib.mjs';
import {
  OUT, appWebviewProcs, killApp, killAppWebview, launch, sleep, stat, table, waitAppGone, waitUntil, watch, writeJson,
} from './dev-perf-lib.mjs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const label = arg('label', 'baseline');
const runs = Number(arg('runs', '3'));
const modes = arg('mode', 'cold,warm').split(',').filter(Boolean);
const exe = arg('exe', 'E:/0-cargo-target/LifeLog/release/LifeLog.exe');
const DEBUG_ENV = { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9222' };

/** 等 CDP 目标出现(返回相对 t0 的 ms);找不到返回 null */
async function waitTarget(t0, match, timeoutMs = 20000) {
  const hit = await waitUntil(async () => {
    try {
      return (await pages()).some(match);
    } catch {
      return false;
    }
  }, timeoutMs, 25);
  return hit === null ? null : Date.now() - t0;
}

/** 输入栏页面的首帧读数(读的是历史 paint 条目,连接晚于绘制也不影响) */
async function inputPaint(t0) {
  const target = (await pages()).find((p) => p.url.includes('input.html'));
  if (!target || !globalThis.WebSocket) return null;
  const ws = new globalThis.WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const send = (method, params = {}) => {
    const mine = ++id;
    ws.send(JSON.stringify({ id: mine, method, params }));
    return new Promise((res) => {
      const on = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === mine) {
          ws.removeEventListener('message', on);
          res(m.result);
        }
      };
      ws.addEventListener('message', on);
    });
  };
  const expr = `(() => { const p = performance.getEntriesByType('paint');
      const at = (n) => { const e = p.find((x) => x.name === n); return e ? Math.round(e.startTime * 10) / 10 : null; };
      const nav = performance.getEntriesByType('navigation')[0] || {};
      return { fcp: at('first-contentful-paint'), fp: at('first-paint'),
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0), readyState: document.readyState }; })()`;
  let value = null;
  for (let i = 0; i < 24; i++) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    value = r.result.value;
    if (value && value.fp !== null) break; // 本应用的透明输入栏不产生 first-contentful-paint,以 first-paint 为首帧口径
    await sleep(50);
  }
  try { ws.close(); } catch { /* 已关闭 */ }
  return { ...value, measuredAt: Date.now() - t0 };
}

async function oneRun(mode, index) {
  killApp();
  await waitAppGone(10000);
  if (mode === 'cold') {
    killAppWebview();
    await sleep(4000);
  } else {
    await sleep(1200);
  }
  const before = appWebviewProcs().map((p) => p.pid); // 仅用于报告「有多少上一轮的 WebView2 进程没退干净」
  const procW = watch(['proc', 'LifeLog.exe', '40000']);
  const winW = watch(['win', '输入栏', '40000']);
  await Promise.all([procW.ready, winW.ready]); // 等两个观测器就绪,消除 python 冷启动对时间戳的拖累
  const { at: spawnAt } = launch(exe, DEBUG_ENV);
  const proc = await procW.done;
  const t0 = proc.at ?? spawnAt;
  const win = await winW.done;
  winW.kill();
  const targetMs = await waitTarget(t0, (p) => p.url.includes('input.html'));
  const paint = targetMs === null ? null : await inputPaint(t0);
  const wv = appWebviewProcs().filter((p) => p.at >= spawnAt);
  const pick = (kind) => {
    const hit = wv.filter((p) => p.kind === kind).sort((a, b) => a.at - b.at)[0];
    return hit ? hit.at - t0 : null;
  };
  const sample = {
    mode, index,
    spawnToProcMs: proc.at ? proc.at - spawnAt : null,
    inputVisibleMs: win.at ? win.at - t0 : null,
    inputVisibleFromSpawnMs: win.at ? win.at - spawnAt : null,
    cdpTargetMs: targetMs,
    inputFcpMs: paint?.fcp ?? null,
    inputFpMs: paint?.fp ?? null,
    inputDclMs: paint?.domContentLoaded ?? null,
    wvBrowserMs: pick('browser'),
    wvRendererMs: pick('renderer'),
    wvGpuMs: pick('gpu'),
    wvUtilityMs: pick('utility'),
    wvLeftoverBefore: before.length,
    inputPid: win.pid ?? null,
    windowTimeout: !!win.timeout,
  };
  console.log(`INFO ${mode}#${index + 1}`, JSON.stringify(sample));
  killApp();
  await waitAppGone(10000);
  return sample;
}

const all = {};
for (const mode of modes) {
  const samples = [];
  for (let i = 0; i < runs; i++) samples.push(await oneRun(mode, i));
  all[mode] = samples;
}
const summary = {};
for (const [mode, samples] of Object.entries(all)) {
  summary[mode] = {
    输入栏可见中位: stat(samples.map((s) => s.inputVisibleMs).filter((v) => v !== null)),
    输入栏首帧中位: stat(samples.map((s) => s.inputFpMs).filter((v) => v !== null)),
    输入栏FCP中位: stat(samples.map((s) => s.inputFcpMs).filter((v) => v !== null)),
    WebView2浏览器进程中位: stat(samples.map((s) => s.wvBrowserMs).filter((v) => v !== null)),
    WebView2渲染器进程中位: stat(samples.map((s) => s.wvRendererMs).filter((v) => v !== null)),
    CDP目标中位: stat(samples.map((s) => s.cdpTargetMs).filter((v) => v !== null)),
  };
  console.log(`\n=== ${mode} ===`);
  table(['样本', '进程出现ms', '输入栏可见ms', '输入栏首帧ms', 'DCLms', 'WV2浏览器ms', 'WV2渲染器ms', 'CDP目标ms'],
    samples.map((s, i) => [i + 1, s.spawnToProcMs, s.inputVisibleMs, s.inputFpMs, s.inputDclMs, s.wvBrowserMs, s.wvRendererMs, s.cdpTargetMs]));
  console.log('中位:', JSON.stringify(summary[mode]));
}
const file = writeJson(`${label}-startup.json`, { label, exe, at: new Date().toISOString(), runs, modes, samples: all, summary });
console.log('INFO 读数已落盘', `${OUT}/${label}-startup.json`, file);
