#!/usr/bin/env node
/**
 * 输入栏启动读数(W1 任务):进程 -> 输入栏可见、WebView2 渲染器进程、页面内首帧/设置已应用、
 * 启动模块清单(transferSize/decodedBodySize),以及「哪块包最贵」的 JS 自耗时归因。
 *
 * 口径(t0 一律是「LifeLog.exe 进程对象出现」,由 dev-perf-winwatch.py 按 kernel32 打点;
 * 窗口可见由 user32 IsWindowVisible 轮询 2-3ms;页面内读数用 performance.timeOrigin 换算回 epoch,
 * 于是「窗口可见」与「页面首帧」落在同一条时间轴上,能直接算出空窗/跳变):
 *   输入栏可见    t0 -> 标题「输入栏」的顶层窗口首次可见
 *   导航开始      t0 -> performance.timeOrigin(页面导航提交时刻)
 *   首帧          t0 -> first-paint(输入栏透明,不产生 first-contentful-paint,故用 first-paint)
 *   设置已应用    t0 -> performance.mark('lifelog-input-settings-applied')
 *                   (产品侧 use-input-settings.reload 打点:真实设置写进 React 状态的时刻;
 *                    另有一个 lifelog-input-always-on-top-applied 覆盖置顶 IPC 往返)
 *   空窗缺口      首帧 - 窗口可见(正 = 窗口先可见、页面后画,存在空窗)
 *   跳变窗口      设置已应用 - 首帧(首帧用内置默认值渲染,真实设置此刻才到位)
 * A 口径(自然启动,冷/暖各 N 次)拿上面全部读数;JS 自耗时按 chunk 归因需要「导航前 Profiler.start」,
 * CDP 只能在窗口出现后连上,故 B 口径用 Page.navigate 重载同源页面(同一份 dist 与缓存态)测。
 * 冷/暖定义同 dev-perf-startup.mjs:冷 = 先杀本应用 WebView2 再等 4s;暖 = 上次退出后立刻启动。
 * 前置:不得有别的 LifeLog 实例(单实例会让新进程静默退出);exe 必须是 release 产物。
 * 用法: node scripts/dev-perf-inputbar.mjs --label=baseline [--runs=5] [--reloads=5] [--mode=cold,warm] [--exe=路径]
 */
import { open, pages } from './cdp-lib.mjs';
import {
  appWebviewProcs, killApp, killAppWebview, launch, sleep, waitAppGone, watch, writeJson,
} from './dev-perf-lib.mjs';
import {
  AOT_MARK, INJECT, SETTINGS_MARK, byUrl, pageMetrics, readPage, waitInputTarget,
} from './dev-perf-inputbar-page.mjs';
import { pickResources, printReload, printResources, printStartup, summarize } from './dev-perf-inputbar-out.mjs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const label = arg('label', 'baseline');
const runs = Number(arg('runs', '5'));
const reloads = Number(arg('reloads', '5'));
const modes = arg('mode', 'cold,warm').split(',').filter(Boolean);
const exe = arg('exe', 'E:/0-cargo-target/LifeLog/release/LifeLog.exe');
const DEBUG_ENV = { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9222' };
const SAMPLE_US = 50; // Profiler 采样间隔(微秒)

const ms1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);

/** 一次自然启动:返回同口径样本(epoch 全部换算到 t0 相对值) */
async function oneRun(mode, index) {
  killApp();
  await waitAppGone(10000);
  if (mode === 'cold') {
    killAppWebview();
    await sleep(4000);
  } else {
    await sleep(1200);
  }
  const procW = watch(['proc', 'LifeLog.exe', '40000']);
  const winW = watch(['win', '输入栏', '40000']);
  await Promise.all([procW.ready, winW.ready]);
  const { at: spawnAt } = launch(exe, DEBUG_ENV);
  const proc = await procW.done;
  const t0 = proc.at ?? spawnAt;
  const win = await winW.done;
  winW.kill();
  const appeared = await waitInputTarget();
  let page = null;
  let perf = null;
  if (appeared) {
    try {
      const { cdp, close } = await open('input');
      await cdp.send('Performance.enable');
      page = await readPage(cdp);
      perf = await pageMetrics(cdp);
      close();
    } catch (e) {
      console.log('WARN 页面读数失败', String(e).slice(0, 200));
    }
  }
  const nav = page ? page.timeOrigin : null;
  const at0 = (rel) => (nav === null || rel === null || rel === undefined ? null : ms1(nav + rel - t0));
  const wv = appWebviewProcs().filter((p) => p.at >= spawnAt);
  const firstOf = (kind) => {
    const hit = wv.filter((p) => p.kind === kind).sort((a, b) => a.at - b.at)[0];
    return hit ? hit.at - t0 : null;
  };
  const sample = {
    mode, index,
    spawnToProcMs: proc.at ? proc.at - spawnAt : null,
    inputVisibleMs: win.at ? win.at - t0 : null,
    navStartMs: nav === null ? null : ms1(nav - t0),
    fpFromSpawnMs: at0(page?.fp),
    fpMs: page?.fp ?? null,
    dclMs: page?.dcl ?? null,
    settingsAppliedMs: at0(page?.settingsApplied),
    aotAppliedMs: at0(page?.aotApplied),
    settingsFailedMs: at0(page?.settingsFailed),
    gapFpMs: page && win.at ? ms1(nav + page.fp - win.at) : null,
    gapSettingsMs: page && page.settingsApplied !== null && page.fp !== null
      ? ms1(page.settingsApplied - page.fp) : null,
    longTaskMs: page?.longTaskMs ?? null,
    scriptMs: perf?.scriptMs ?? null,
    taskMs: perf?.taskMs ?? null,
    styleMs: perf?.styleMs ?? null,
    heapMb: perf?.heapMb ?? null,
    cdpTargetMs: appeared ? Date.now() - t0 : null,
    wvBrowserMs: firstOf('browser'),
    wvRendererMs: firstOf('renderer'),
    resources: page?.res ?? [],
    windowTimeout: !!win.timeout,
  };
  console.log(`INFO ${mode}#${index + 1}`, JSON.stringify({
    inputVisibleMs: sample.inputVisibleMs, navStartMs: sample.navStartMs, fpFromSpawnMs: sample.fpFromSpawnMs,
    settingsAppliedMs: sample.settingsAppliedMs, aotAppliedMs: sample.aotAppliedMs,
    gapFpMs: sample.gapFpMs, gapSettingsMs: sample.gapSettingsMs, wvRendererMs: sample.wvRendererMs,
    scriptMs: sample.scriptMs, taskMs: sample.taskMs, heapMb: sample.heapMb,
  }));
  killApp();
  await waitAppGone(10000);
  return sample;
}

/** B 口径:已启动的输入栏页上重载 N 次,导航前开 Profiler,拿到按 chunk 的 JS 自耗时 */
async function reloadRuns(n) {
  killApp();
  await waitAppGone(10000);
  killAppWebview();
  await sleep(4000);
  const winW = watch(['win', '输入栏', '40000']);
  await winW.ready;
  launch(exe, DEBUG_ENV);
  const win = await winW.done;
  winW.kill();
  if (!win.pid || !(await waitInputTarget())) throw new Error('输入栏未出现,重载口径不可测');
  const target = (await pages()).find((p) => p.url.includes('input.html'));
  const url = target.url.split('#')[0];
  const { cdp, close } = await open('input');
  await cdp.send('Page.enable');
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: SAMPLE_US });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
  const samples = [];
  for (let i = 0; i < n; i++) {
    await cdp.send('Profiler.start');
    await cdp.send('Page.navigate', { url });
    const read = await readPage(cdp, 80);
    const { profile } = await cdp.send('Profiler.stop');
    const jsByUrl = byUrl(profile, SAMPLE_US / 1000);
    const res = read?.res ?? [];
    const sample = {
      index: i, fpMs: read?.fp ?? null, dclMs: read?.dcl ?? null,
      settingsAppliedMs: read?.settingsApplied ?? null, aotAppliedMs: read?.aotApplied ?? null,
      gapSettingsMs: read?.settingsApplied !== null && read?.fp !== null
        ? ms1(read.settingsApplied - read.fp) : null,
      longTaskMs: read?.longTaskMs ?? null, jsByUrl,
      jsTotalMs: Object.values(jsByUrl).reduce((a, b) => a + b, 0),
      chunksKb: res.filter((r) => r.file.endsWith('.js')).map((r) => `${r.file.replace(/-\w+\.js$/, '')}:${Math.round(r.decoded / 1024)}K`),
    };
    samples.push(sample);
    console.log(`INFO reload#${i + 1}`, JSON.stringify({ ...sample, jsByUrl: undefined, chunksKb: sample.chunksKb.join(' ') }));
    await sleep(500);
  }
  close();
  killApp();
  await waitAppGone(10000);
  return { url, samples };
}

const all = {};
for (const mode of modes) {
  const samples = [];
  for (let i = 0; i < runs; i++) samples.push(await oneRun(mode, i));
  all[mode] = samples;
}
const summary = summarize(all);
printStartup(all, summary);
const resources = pickResources(all);
printResources(resources);

const reload = await reloadRuns(reloads);
const { jsMedian, reloadSummary } = printReload(reload);

const file = writeJson(`${label}-inputbar.json`, {
  label, exe, at: new Date().toISOString(), runs, reloads, modes,
  marks: { settings: SETTINGS_MARK, alwaysOnTop: AOT_MARK },
  samples: all, summary, startupResources: resources, reloadUrl: reload.url,
  reloadSamples: reload.samples, reloadJsMedian: jsMedian, reloadSummary,
});
console.log('INFO 读数已落盘', file);
