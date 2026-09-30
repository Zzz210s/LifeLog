#!/usr/bin/env node
/**
 * 关系图真机读数:G1 的 1-6 与 11(计划 2026-09-28-graph-g1.md 的 Task 6),G2 的八条在
 * scripts/graph-accept-g2.mjs(悬停/单击/双击/右键/搜索/键盘守卫/筛到信息流/只读对账,读数 5 之后跑)。
 *
 *   1 首帧可见 ≤150ms(命令执行 -> 首个有内容的画布绘制;另报 DOM 挂载时刻)
 *   2 graph_data ≤40ms,并报节点/边数与 JSON 载荷
 *   3 径向布局耗时 ≤10ms(开发构建下 import 源码模块对纯函数计时;生产构建无源码路径时只打 INFO)
 *   4 静止 3 秒:画布绘制调用 0 次 + 内容签名(着墨数/列桶/指纹)不变(设计 §3.3「静止不重绘」)
 *   5 缩放/平移/按 0 复位:200 帧帧间隔中位 ≤18ms;着墨质心随平移走(Δ≥拖拽量一半)、再按 0 回到原位(±8 设备像素)。
 *     判据用质心而不是像素指纹:进视图首次栅格与之后的重绘有亚像素差异(实测 127235 像素不同而相机/计划逐项相同)
 *   6 打开关系图的内存增量 ≤15MB。判据取 JS 堆(CDP Runtime.getHeapUsage):RSS 会被 WebView2 预热与 GC 抖动淹没
 *  11 只读:库计数 + 全量笔记/标签清单 + get_db_info 与开工前逐项一致
 *
 * 用法:LIFELOG_CDP_PORT=9222 node scripts/dev-graph-accept.mjs;先起应用(vite + 带调试端口的 dev exe,
 *   或装机版);没起时明确报「需要先起应用」并以 2 退出。键鼠全走 CDP 合成事件(不碰物理鼠标),真实库只读。
 */
import { BASE, bindMain, ensureMain, recorder, sleep } from './cdp-lib.mjs';
import { bindUi, dbCounts } from './no-tabs-accept-lib.mjs';
import { psJson } from './dev-perf-lib.mjs';
import {
  armGraph, closeGraph, drawSignature, installPaintCounter, layoutMs, paintCalls, panDrag, resetPaint, waitFirstDraw, wheelFrames,
} from './graph-accept-lib.mjs';
import { runGraphG2 } from './graph-accept-g2.mjs';

const rec = recorder();
const { record, finish } = rec;
const round1 = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
const mb = (b) => Math.round((b / 1024 / 1024) * 10) / 10;
/** psJson 对单元素数组会回 `[49.2]`,这里取标量(取不到返回 null) */
const scalar = (v) => (Array.isArray(v) ? (typeof v[0] === 'number' ? v[0] : null) : typeof v === 'number' ? v : null);
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

/** 应用自身进程的内存(MB) */
const appMb = () =>
  scalar(psJson(`ConvertTo-Json -Compress -InputObject @(Get-Process -Name LifeLog -ErrorAction SilentlyContinue |
    Measure-Object WorkingSet64 -Sum | ForEach-Object { [math]::Round($_.Sum/1MB,1) })`));
/** 认领到本应用的 WebView2 子进程内存合计(MB):关系图的开销主要在渲染进程里 */
const webviewMb = () =>
  scalar(psJson(`ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
    Where-Object { $_.CommandLine -like '*com.lifelog.app*' } |
    ForEach-Object { (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).WorkingSet64 } |
    Measure-Object -Sum | ForEach-Object { [math]::Round($_.Sum/1MB,1) })`));
const memNow = () => {
  const app = appMb();
  const webview = webviewMb();
  return { app, webview, total: typeof app === 'number' && typeof webview === 'number' ? round1(app + webview) : null };
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 前置:调试端口在不在(没起应用就明确报,不抛栈)
const alive = await fetch(`${BASE}/json/version`).then((r) => r.ok, () => false);
if (!alive) {
  console.error(`需要先起应用:调试端口 ${BASE} 无响应。先 pnpm dev,再带 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 起 dev exe(或用装机版 + LIFELOG_CDP_PORT)。`);
  process.exit(2);
}
let conn;
try {
  conn = await ensureMain();
} catch (e) {
  console.error(`需要先起应用(主窗没出现):${e.message}`);
  process.exit(2);
}
const ui = bindUi(conn.cdp);
const bm = bindMain(conn.cdp);
const ev = (e) => conn.cdp.eval(e);
await installPaintCounter(conn.cdp);
// 起点归零:上一次跑完可能还停在关系图里(Escape 退出),否则 ① 测不到「进图」这一下
const fromStream = await closeGraph(ui);
if (!fromStream) console.log('INFO  起点不在关系图:已在信息流视图');

// 0) 基线:库计数 + 全量清单;并让刚被托盘创建出来的主窗收尾(尺寸/DPR 还在抖,冷开首帧会被算进去)
const info0 = await bm.call('get_db_info');
const counts0 = dbCounts();
const inv0 = await bm.inventory();
await sleep(3000);
const mem0 = memNow();
const heap0 = await conn.cdp.send('Runtime.getHeapUsage');
console.log(`基线:笔记 ${counts0.notes} / 标签 ${counts0.tags} / 链接 ${counts0.links};JS 堆 ${mb(heap0.usedSize)}MB;RSS app=${mem0.app}MB webview=${mem0.webview}MB`);

// 1) 进图命令执行 -> 首帧可见
await resetPaint(conn.cdp);
const rows = await armGraph(ui);
const first = await waitFirstDraw(conn.cdp);
const picked = rows.some((r) => r.id === 'graph.open');
if (first.paintMs < 0 || !picked) {
  record('1 首帧可见 ≤150ms', false, `画布没画出来(${JSON.stringify(first)});候选行=${JSON.stringify(rows)}`);
  finish();
  process.exit(1);
}
record(
  '1 首帧可见 ≤150ms',
  first.paintMs <= 150,
  `${first.paintMs}ms(命令执行 -> 首次绘制;DOM 挂载 ${first.mountMs}ms,轮询取回 ${first.observedMs}ms;候选 ${rows.length} 条,命中 graph.open)`,
);

// 6) 内存增量:进图 2 秒后相对进图前基线的 JS 堆增量(这才是"打开关系图"的开销)
await sleep(2000);
const heap1 = await conn.cdp.send('Runtime.getHeapUsage');
const mem1 = memNow();
record(
  '6 打开关系图的内存增量 ≤15MB(JS 堆;窗口紧贴进图)',
  heap1.usedSize - heap0.usedSize <= 15 * 1024 * 1024,
  `JS 堆 ${mb(heap0.usedSize)} -> ${mb(heap1.usedSize)}MB(Δ${mb(heap1.usedSize - heap0.usedSize)}),数组缓冲 Δ${mb(heap1.backingStorageSize - heap0.backingStorageSize)}MB;` +
    `RSS app ${mem0.app} -> ${mem1.app},webview ${mem0.webview} -> ${mem1.webview}(Δ${round1(mem1.total - mem0.total)}MB,含 GC 抖动)`,
);

// 2) 数据加载耗时与载荷
const load = await ev(`(async () => {
  const T = window.__TAURI_INTERNALS__.invoke;
  const t = performance.now();
  const d = await T('graph_data');
  const bytes = new TextEncoder().encode(JSON.stringify(d)).length;
  return { ms: Math.round(performance.now() - t), kb: Math.round(bytes / 1024), nodes: d.nodes.length, edges: d.edges.length };
})()`);
record('2 graph_data ≤40ms', load.ms <= 40, `${load.ms}ms / ${load.kb}KB(${load.nodes} 节点 / ${load.edges} 边)`);

// 3) 布局耗时(开发构建才有源码模块路径)
const layout = await layoutMs(conn.cdp);
if (layout === null) console.log('INFO  3 布局耗时:生产构建没有源码模块路径,本次不单独计时');
else record('3 径向布局耗时 ≤10ms', layout.ms <= 10, `${layout.ms}ms(${layout.nodes} 节点 = 视图真实布局点集;graph_data 原始 ${layout.raw} 条,折叠 ${layout.roots.join('、') || '(无)'} 根后由 visibleGraph 给出;${layout.runs} 次取中位)`);

// 4) 先等画布安静,再量严格 3 秒:绘制调用与内容签名都不该动。
// 首次数位读回会触发一次重栅格化(AA 级差异、零绘制调用),故第一步先丢弃一次读数。
let settleDraws = 0;
for (let i = 0; i < 12; i++) {
  const a = await paintCalls(conn.cdp);
  await sleep(500);
  const b = await paintCalls(conn.cdp);
  settleDraws += sum(b) - sum(a);
  if (sum(b) - sum(a) === 0) break;
}
await drawSignature(conn.cdp); // 丢弃:触发重栅格化
await sleep(700);
const state0 = await drawSignature(conn.cdp);
const win0 = await ev(`({ iw: window.innerWidth, ih: window.innerHeight, dpr: window.devicePixelRatio })`);
await sleep(3000);
const state1 = await drawSignature(conn.cdp);
const win1 = await ev(`({ iw: window.innerWidth, ih: window.innerHeight, dpr: window.devicePixelRatio })`);
const draws = state1.draws - state0.draws;
record(
  '4 静止 3 秒:画布绘制 0 次且内容签名不变',
  draws === 0 && state0 !== null && state0.fp === state1?.fp && state0.painted === state1?.painted,
  `静置前收尾重绘 ${settleDraws} 次;测量窗口内绘制 ${draws} 次;\n` +
    `        画布 ${state0?.w}x${state0?.h}(${state0?.painted} 着墨,${state0?.fp}) -> ${state1?.w}x${state1?.h}(${state1?.painted} 着墨,${state1?.fp});` +
    `视口 ${win0.iw}x${win0.ih}@${win0.dpr} -> ${win1.iw}x${win1.ih}@${win1.dpr}`,
);

// 5) 缩放/平移/复位的真实效果:200 帧帧间隔 + 着墨质心随相机走
//    像素签名只当"变没变"用(进视图首次栅格与之后的重绘有亚像素级差异,见 task-6 报告),
//    "平移了多少、复位回去了没"一律看质心:亚像素偏移动不了它,相机位移会拽着它走。
const frames = await wheelFrames(conn.cdp);
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }))`); // 先复位:适配视图留白最大,平移裁切对质心的干扰最小
await sleep(700);
await drawSignature(conn.cdp); // 丢弃一次重栅格化读数
const beforePan = await drawSignature(conn.cdp);
await panDrag(conn.cdp);
await sleep(700);
await drawSignature(conn.cdp);
const afterPan = await drawSignature(conn.cdp);
const dx = afterPan.cx - beforePan.cx;
const dy = afterPan.cy - beforePan.cy;
// panDrag 拖的是 (60,36) CSS px(dpr 1.25 下略 (75,45) 设备像素):取一半作下限,方向必须对
const panned = dx >= 40 && dy >= 20;
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }))`); // 再按 0:质心应回到适配位置
await sleep(700);
await drawSignature(conn.cdp);
const home = await drawSignature(conn.cdp);
const back = Math.abs(home.cx - beforePan.cx) <= 8 && Math.abs(home.cy - beforePan.cy) <= 8;
record(
  '5 缩放/平移 200 帧:帧间隔中位 ≤18ms 且平移/按 0 复位生效',
  frames.median <= 18 && beforePan !== null && afterPan !== null && panned && back &&
    home !== null && (beforePan.fp !== afterPan.fp || beforePan.painted !== afterPan.painted),
  `中位 ${frames.median}ms / p95 ${frames.p95}ms / 最大 ${frames.max}ms;平移后质心 (${beforePan?.cx},${beforePan?.cy}) -> (${afterPan?.cx},${afterPan?.cy}) (Δ${dx},${dy});` +
    `再按 0 复位后质心 (${home?.cx},${home?.cy}),与平移前差 (${Math.abs((home?.cx ?? 0) - (beforePan?.cx ?? 0))},${Math.abs((home?.cy ?? 0) - (beforePan?.cy ?? 0))});` +
    `着墨 ${beforePan?.painted} -> ${afterPan?.painted} -> ${home?.painted},列桶差异 ${beforePan?.buckets.filter((v, i) => v !== afterPan?.buckets[i]).length}/16,` +
    `绘制调用 +${afterPan === null ? '?' : afterPan.draws - beforePan.draws}`,
);

await runGraphG2({ cdp: conn.cdp, ev, ui, bm, record }); // G2 八条读数:悬停/单击/双击/右键/搜索/守卫/筛到信息流/只读

// 11) 退出关系图后对账:数据零影响
const closed = await closeGraph(ui);
await sleep(800);
const info1 = await bm.call('get_db_info');
const counts1 = dbCounts();
const inv1 = await bm.inventory();
record(
  '11 只读:库计数/全量清单/get_db_info 与开工前一致',
  closed === true && same(counts0, counts1) && same(inv0, inv1) && same(info0, info1),
  `退出=${closed === true};笔记 ${counts1.notes} / 标签 ${counts1.tags} / 链接 ${counts1.links} / 别名 ${counts1.aliases};` +
    `integrity=${counts1.integrity} user_version=${counts1.version};` +
    `graph_positions=${JSON.stringify(inv1.graphPositions)};get_db_info=${JSON.stringify(info1)}`,
);

// 关连接再硬退:finish() 只设 exitCode,开着的 WebSocket 会拖住事件循环(实测 12s 仍不退出)
finish();
conn.close();
process.exit(rec.results.some((x) => !x.ok) ? 1 : 0);
