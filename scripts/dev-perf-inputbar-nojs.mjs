#!/usr/bin/env node
/**
 * 输入栏「无 JS 骨架」口径:量化「把 React 从首帧路径上拿掉」到底能省多少 —— 为 W1 的判定
 * 「这 230KB 是 React 运行时、挪不动」给出替代方案的上限读数,而不是拍脑袋估。
 *
 * 做法:把输入栏 webview 当测量台。先由本地 http 服务提供一份**与真实输入栏同一份 CSS、
 * 同一份 DOM 结构、但没有一行 JS** 的骨架页,然后用 CDP 在同一 webview 里分两块各测 N 次
 * (先骨架后真实,每块先热身一次:跨 origin 导航会换渲染进程,交替导航会把进程启动成本
 * 摊到每一次读数上,分块才不会把噪声算到 JS 头上):
 *   骨架 = 只付 CSS 解析 + 样式/布局 + 一次绘制
 *   真实 = 再叠上 React/react-dom 解析求值、应用代码执行、9 次 get_setting IPC 与置顶 IPC
 * 两者都在重载(暖代码缓存)口径下测,故这个是**暖态上限**;冷态的 JS 代价用
 * dev-perf-inputbar.mjs 的自然启动读数(Performance.getMetrics 的 ScriptDuration)约束。
 * 注意:该口径只回答「首帧(内容出现)能提前多少」,不回答「输入栏窗口可见能提前多少」——
 * 窗口可见由 Rust/WebView2 启动决定,实测早于首帧(见报告里的空窗读数)。
 * 用法: node scripts/dev-perf-inputbar-nojs.mjs [--rounds=4] [--exe=路径]
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { open, pages } from './cdp-lib.mjs';
import { killApp, killAppWebview, launch, sleep, stat, table, waitAppGone, watch, writeJson } from './dev-perf-lib.mjs';
import { READ, waitInputTarget } from './dev-perf-inputbar-page.mjs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).slice(k.length + 3);
const rounds = Number(arg('rounds', '4'));
const exe = arg('exe', 'E:/0-cargo-target/LifeLog/release/LifeLog.exe');
const PORT = Number(arg('port', '5199'));
const DEBUG_ENV = { WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9222' };

/** 骨架页:与 InputBar 首帧同构的外层 div + textarea(同一份 Tailwind 类名),一行 JS 都没有 */
const SKELETON = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8" /><link rel="stylesheet" href="/input.css" />
<title>输入栏骨架</title></head><body>
<div id="root"><div class="relative box-border flex h-screen w-full cursor-move flex-col p-[14px]">
<textarea class="sticker-input min-h-0 w-full flex-1 resize-none overflow-y-auto bg-raised px-3 py-2 text-sm leading-relaxed text-text read-only:text-faint" autofocus></textarea>
</div></div></body></html>`;

/** 静态服务:骨架 HTML + dist 里那份输入栏 CSS(与真实页面同一份样式表) */
function serve() {
  const css = readFileSync('dist/assets/input-BDCi8Bp0.css');
  const server = createServer((req, res) => {
    if (req.url.startsWith('/input.css')) {
      res.writeHead(200, { 'content-type': 'text/css' });
      res.end(css);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(SKELETON);
  });
  return new Promise((res) => server.listen(PORT, '127.0.0.1', () => res(server)));
}

/** 导航并等首帧(打点可能没有,这里只等 first-paint);返回相对 timeOrigin 的读数 */
async function navigateAndRead(cdp, url, needMark) {
  await cdp.send('Page.navigate', { url });
  let last = null;
  for (let i = 0; i < 100; i++) {
    last = await cdp.eval(READ);
    if (last && last.fp !== null && (!needMark || last.settingsApplied !== null || last.settingsFailed !== null)) break;
    await sleep(30);
  }
  return last;
}

const server = await serve();
killApp();
await waitAppGone(10000);
killAppWebview();
await sleep(4000);
const winW = watch(['win', '输入栏', '40000']);
await winW.ready;
launch(exe, DEBUG_ENV);
const win = await winW.done;
winW.kill();
if (!win.pid || !(await waitInputTarget())) throw new Error('输入栏未出现,骨架口径不可测');
const realUrl = (await pages()).find((p) => p.url.includes('input.html')).url.split('#')[0];
const { cdp, close } = await open('input');
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Performance.enable');

/** 一块 N 次读数(先热身一次建缓存/固定渲染进程);scriptMs 取页面累计 JS 执行 */
async function block(url, needMark) {
  await navigateAndRead(cdp, url, needMark);
  const rows = [];
  for (let i = 0; i < rounds; i++) {
    const r = await navigateAndRead(cdp, url, needMark);
    const m = await cdp.send('Performance.getMetrics');
    const script = m.metrics.find((x) => x.name === 'ScriptDuration')?.value ?? null;
    rows.push({ round: i + 1, fpMs: r?.fp ?? null, dclMs: r?.dcl ?? null,
      scriptMs: script === null ? null : Math.round(script * 1000) });
    console.log(`INFO round#${i + 1}`, url.includes('skeleton') ? '骨架' : '真实', JSON.stringify(rows.at(-1)));
    await sleep(300);
  }
  return rows;
}

const skeleton = await block(`http://127.0.0.1:${PORT}/skeleton.html`, false);
const real = await block(realUrl, true);
close();
killApp();
await waitAppGone(10000);
server.close();

const col = (rows, f) => rows.map(f).filter((v) => v !== null);
const summary = {
  骨架首帧: stat(col(skeleton, (s) => s.fpMs)),
  骨架DCL: stat(col(skeleton, (s) => s.dclMs)),
  真实首帧: stat(col(real, (s) => s.fpMs)),
  真实DCL: stat(col(real, (s) => s.dclMs)),
  JS执行累计: stat(col(real, (s) => s.scriptMs)),
};
summary.首帧差中位 = summary.真实首帧.median === null || summary.骨架首帧.median === null
  ? null : summary.真实首帧.median - summary.骨架首帧.median;
console.log('\n=== 无 JS 骨架 vs 真实输入栏(重载口径,同一 webview 分块)===');
table(['轮', '骨架首帧ms', '骨架DCLms', '真实首帧ms', '真实DCLms', '真实JS执行ms'],
  skeleton.map((s, i) => [i + 1, s.fpMs, s.dclMs, real[i]?.fpMs, real[i]?.dclMs, real[i]?.scriptMs]));
console.log('中位:', JSON.stringify(summary));
const file = writeJson('inputbar-nojs.json', {
  at: new Date().toISOString(), exe, rounds, realUrl, skeleton: `http://127.0.0.1:${PORT}/skeleton.html`,
  rows: { skeleton, real }, summary,
});
console.log('INFO 读数已落盘', file);
