// 启动/首帧 perf 测量的公共件:进程与窗口读数(PowerShell CIM)、应用启停、统计与落盘。
// 与验收脚本(cdp-lib.mjs)分开:这里只做「计时与生命周期」,断言与库存审计不在这里。
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const OUT = '.superpowers/perf';
export const SCRIPT = (name) => resolve(process.cwd(), 'scripts', name);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 单次 PowerShell(禁用 profile/交互;输出强制 UTF-8,避免中文 JSON 被按 GBK 解) */
export function ps(script) {
  const wrapped = '$ProgressPreference="SilentlyContinue";[Console]::OutputEncoding=[Text.Encoding]::UTF8;' + script;
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', wrapped],
    { encoding: 'utf8', maxBuffer: 8 << 20, windowsHide: true });
  return (r.stdout || '').trim();
}

/** JSON 输出型 PowerShell(空输出 -> null) */
export function psJson(script) {
  const text = ps(script);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 应用自身进程 pid(LifeLog.exe);release 与 dev 产物同名,按单实例前提最多一个 */
export function appPids() {
  const rows = psJson('ConvertTo-Json -Compress -InputObject @(Get-Process -Name LifeLog -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })');
  return (Array.isArray(rows) ? rows : rows === null ? [] : [rows]).filter((n) => typeof n === 'number');
}

/** 该应用的 WebView2 进程(按 user-data-dir 认领,避免误伤其他应用的 WebView2) */
export function appWebviewProcs() {
  const rows = psJson(`ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
    Where-Object { $_.CommandLine -like '*com.lifelog.app*' } |
    ForEach-Object {
      $kind = 'browser'
      if ($_.CommandLine -like '*--type=renderer*') { $kind = 'renderer' }
      elseif ($_.CommandLine -like '*--type=gpu-process*') { $kind = 'gpu' }
      elseif ($_.CommandLine -like '*--type=utility*') { $kind = 'utility' }
      elseif ($_.CommandLine -like '*--type=crashpad-handler*') { $kind = 'crashpad' }
      [pscustomobject]@{ pid = $_.ProcessId; kind = $kind
        at = [int64](($_.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds) }
    })`);
  return Array.isArray(rows) ? rows : rows === null ? [] : [rows];
}

export function killApp() {
  ps('Stop-Process -Name LifeLog -Force -ErrorAction SilentlyContinue');
}

/** 只杀本应用的 WebView2(进程冷启动态:必须连 WebView2 一起清掉) */
export function killAppWebview() {
  ps(`Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
    Where-Object { $_.CommandLine -like '*com.lifelog.app*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`);
}

/** 轮询直到 ok() 为真;返回耗时 ms,超时返回 null */
export async function waitUntil(ok, timeoutMs = 15000, gap = 30) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await ok()) return Date.now() - t0;
    await sleep(gap);
  }
  return null;
}

export async function waitAppGone(timeoutMs = 10000) {
  return waitUntil(() => appPids().length === 0, timeoutMs, 50);
}

/**
 * 启动观测器(python 轮询进程):等它吐出 ready 行后再启动被测进程,
 * 这样它自己的解释器冷启动不会把第一次枚举/第一次可见的时间戳推后。
 * 返回 {ready: Promise, done: Promise, kill};done 是结果那一行的 JSON。
 */
export function watch(args) {
  const child = spawn('python', [SCRIPT('dev-perf-winwatch.py'), ...args], { windowsHide: true });
  const lines = [];
  const waiters = [];
  const push = (line) => {
    lines.push(line);
    while (waiters.length && lines.length) waiters.shift()(lines.shift());
  };
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) {
        try {
          push(JSON.parse(line));
        } catch {
          push({ error: 'bad line', line });
        }
      }
    }
  });
  child.on('error', () => push({ error: 'spawn failed' }));
  const next = () => new Promise((res) => (lines.length ? res(lines.shift()) : waiters.push(res)));
  return { ready: next(), done: next(), kill: () => child.kill() };
}

/** 启动应用(不等待);返回 pid 与 spawn 时刻 */
export function launch(exe, extraEnv = {}) {
  const t0 = Date.now();
  const child = spawn(exe, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    env: { ...process.env, ...extraEnv },
  });
  child.unref();
  return { at: t0, pid: child.pid };
}

export function writeJson(name, data) {
  mkdirSync(OUT, { recursive: true });
  const file = `${OUT}/${name}`;
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** 样本 -> {n,min,median,max};(空 -> 全 null) */
export function stat(xs) {
  if (!xs.length) return { n: 0, min: null, median: null, max: null };
  return { n: xs.length, min: Math.min(...xs), median: median(xs), max: Math.max(...xs) };
}

export const ms = (xs) => xs.map((v) => (v === null ? 'null' : Math.round(v)));

/** 打印一张 label/数值列的对齐表 */
export function table(headers, rows) {
  const widths = headers.map((h, i) => Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  rows.forEach((r) => console.log(line(r)));
}
