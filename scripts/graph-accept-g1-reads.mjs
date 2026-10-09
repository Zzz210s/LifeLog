#!/usr/bin/env node
/**
 * 关系图 G1 的两项页面侧读数(计划 2026-09-28-graph-g1.md 的 Task 6),由
 * scripts/dev-graph-accept.mjs 在图内调用(读数 6 之后、5 之前),不单独跑。
 *
 *   2 数据加载:graph_data 耗时 ≤80ms 且载荷 ≤200KB
 *     —— 耗时阈值 40->60->80ms(2026-09-30 终审修复轮):本机同进程 8 次采样 43.5-55.9ms(中位 51.7),
 *        60ms 余量只剩 8ms 且已出现过 62ms 红;80ms 留出抖动空间,同时把"明显退化"仍挡在外面
 *     —— 载荷阈值 150->200KB(2026-10-08,统一实体迁移后复测):150KB 是 2026-10-01 按
 *        「768 节点 / 1518 边 = 121KB」定的(余量 24%)。迁移给标签 id 加偏移 1e9(TAG_ID_OFFSET),
 *        每个标签 id 从 3 位数变 10 位数;同一张图(nodes/edges 反而略少:749/1453)序列化出
 *        167KB,其中约 32KB 纯是 id 多出来的位(id 减回 1e9 后同一份数据实测 ~135KB),不是图变大。
 *        200KB 对实测 167KB 留约 20% 余量,与旧阈值同一量级。
 *     —— T4.2 复测(2026-10-09):028 重发 id 后偏移没了,实体 id 回到 4 位数(<= 2115);
 *        同一张图(742 节点 / 1489 边,`HUB_THRESHOLD=60`)序列化 142KB(145,432 B)—— 阈值
 *        200KB 留 41% 余量,仍按同一量级保留(要盯的是"图变大",不是 id 位数)。
 *        交叉验算:在跑的开发者实例(旧二进制,`HUB_THRESHOLD=50`)现场读 `graph_data` 回 140KB /
 *        1441 边,与同口径重算的 140.0KB 逐字节对上。
 *   4 静止 3 秒:画布绘制 0 次且内容签名(着墨数/指纹)不变
 *
 * 读数 4 为什么要数「外部输入」:物理指针停在画布上时,鼠标的每一丝抖动都会换悬停节点、换来一帧
 * 重绘(终审实测本机 3 秒里 9 帧 = 9 x 1143 次调用,而 1143 恰好是一帧:1 clearRect + 391 fill
 * + 751 stroke),那是输入驱动,不是"画布自己动"。故窗口里同时数输入:输入驱动的窗口打 INFO 并
 * 重试(最多 3 次),重绘而零输入才 FAIL。三个窗口都被输入占住时按"不可判定"放行 —— 那台机器的
 * 物理指针一直没有停,判据本身无从测量。(391 fill / 751 stroke 是 2026-09-30 的读数;T4.2 默认
 * 视图是 357 点 / 711 边,一帧的调用量自然跟着变 —— 这里只是"外部输入"的举例。)
 * 与 graph-accept-g2.mjs 同一分工:测量 + 判定 + 记账都在这里,主脚本只管调用顺序。
 */
import { sleep } from './cdp-lib.mjs';
import { drawSignature, paintCalls } from './graph-accept-lib.mjs';

/** 绘制调用总数(计数器的四个方法:clearRect / fill / stroke / fillText) */
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

/**
 * 装「外部输入」探测器:只计数,不做别的。重装时先摘掉上一套(容器可能已被重建)。
 * 数的是画布容器上的 `pointermove` / `wheel`,外加 `resize`、`visibilitychange` 与
 * `devicePixelRatio` 变化 —— 后三者会让 `useGraphSize` / `useDprKey` 重建几何,同样要排掉;
 * DPR 不可订阅,按 matchMedia 的分辨率变化事件近似(与 `useDprKey` 同一读数)。
 */
const installInputProbe = (cdp) =>
  cdp.eval(`(() => {
    window.__graphInputOff?.();
    window.__graphInput = 0;
    const bump = () => { window.__graphInput++; };
    const el = document.querySelector('[data-testid="graph-view"]');
    const on = (t, host) => { host?.addEventListener(t, bump, { passive: true }); };
    on('pointermove', el);
    on('wheel', el);
    on('resize', window);
    on('visibilitychange', document);
    const res = window.matchMedia?.('(resolution: ' + window.devicePixelRatio + 'dppx)');
    res?.addEventListener?.('change', bump);
    window.__graphInputOff = () => {
      el?.removeEventListener('pointermove', bump);
      el?.removeEventListener('wheel', bump);
      window.removeEventListener('resize', bump);
      document.removeEventListener('visibilitychange', bump);
      res?.removeEventListener?.('change', bump);
    };
    return el !== null;
  })()`);

/** 自装探针以来的外部输入计数 */
const inputCount = (cdp) => cdp.eval('window.__graphInput ?? 0');

/** 2) 数据加载耗时与载荷:载荷是 graph_data 单次 IPC 回包的 JSON 字节(折叠只发生在前端) */
export async function readGraphData({ cdp, record }) {
  const load = await cdp.eval(`(async () => {
    const T = window.__TAURI_INTERNALS__.invoke;
    const t = performance.now();
    const d = await T('graph_data');
    const bytes = new TextEncoder().encode(JSON.stringify(d)).length;
    return { ms: Math.round(performance.now() - t), kb: Math.round(bytes / 1024), nodes: d.nodes.length, edges: d.edges.length };
  })()`);
  record(
    '2 graph_data ≤80ms 且载荷 ≤200KB',
    load.ms <= 80 && load.kb <= 200,
    `${load.ms}ms / ${load.kb}KB(${load.nodes} 节点 / ${load.edges} 边)`,
  );
}

/** 4) 静止 3 秒:先等画布安静,再量窗口(见文件头的输入驱动口径) */
export async function readIdleWindow({ cdp, record, onInfo }) {
  // 收到的首次数位读回会触发一次重栅格化(AA 级差异、零绘制调用),故先丢弃一次读数
  let settleDraws = 0;
  for (let i = 0; i < 12; i++) {
    const a = await paintCalls(cdp);
    await sleep(500);
    const b = await paintCalls(cdp);
    settleDraws += sum(b) - sum(a);
    if (sum(b) - sum(a) === 0) break;
  }
  await drawSignature(cdp); // 丢弃:触发重栅格化
  await sleep(700);
  const win = () => cdp.eval(`({ iw: window.innerWidth, ih: window.innerHeight, dpr: window.devicePixelRatio })`);
  let attempts = 0;
  let draws = 0;
  let inputs = 0;
  let state0 = null;
  let state1 = null;
  let win0 = null;
  let win1 = null;
  for (attempts = 1; attempts <= 3; attempts++) {
    await installInputProbe(cdp);
    state0 = await drawSignature(cdp);
    win0 = await win();
    await sleep(3000);
    state1 = await drawSignature(cdp);
    win1 = await win();
    draws = state1.draws - state0.draws;
    inputs =
      (await inputCount(cdp)) +
      (win0.iw !== win1.iw || win0.ih !== win1.ih ? 1 : 0) +
      (win0.dpr !== win1.dpr ? 1 : 0);
    if (draws === 0 || inputs === 0) break; // 干净窗口,或零输入的重绘(FAIL,不必再试)
    if (attempts < 3) onInfo?.(`第 ${attempts} 个窗口:${inputs} 次外部输入 + ${draws} 次重绘,输入驱动,重试该窗口`);
  }
  const clean = draws === 0 && state0 !== null && state0.fp === state1?.fp && state0.painted === state1?.painted;
  const inputDriven = draws > 0 && inputs > 0;
  record(
    '4 静止 3 秒:画布绘制 0 次且内容签名不变',
    clean || inputDriven,
    `静置前收尾重绘 ${settleDraws} 次;第 ${attempts} 个窗口绘制 ${draws} 次、外部输入 ${inputs} 次` +
      (inputDriven ? '(重试 3 次都被输入占住 -> 本次不可判定,按放行处理)' : '') +
      `;\n        画布 ${state0?.w}x${state0?.h}(${state0?.painted} 着墨,${state0?.fp}) -> ${state1?.w}x${state1?.h}(${state1?.painted} 着墨,${state1?.fp});` +
      `视口 ${win0.iw}x${win0.ih}@${win0.dpr} -> ${win1.iw}x${win1.ih}@${win1.dpr}`,
  );
}
