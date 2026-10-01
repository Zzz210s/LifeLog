/**
 * 关系图 G3 真机读数的读数 5-6:拖节点 + 位置记忆,以及「整理布局」的现场测量。
 * 由 graph-accept-g3.mjs 调用;判定与文案都在这里,主脚本只摆顺序。
 * 读数 5 的起手点由 `nodeSpot` 在页面里用 `hitTest` 验证「圆心真的命中它自己」——
 * G1 读数 5 的拖空白平移就踩过反过来的坑(写死的坐标落在节点上会变成拖节点、还会真写库)。
 */
import { sleep } from './cdp-lib.mjs';
import { armGraph, closeGraph } from './graph-accept-lib.mjs';
import { clickAt, lastFrame, pointerDrag } from './graph-accept-g3-lib.mjs';
import { nodeSpot, worldPairs } from './graph-accept-g3-scene.mjs';

/** 这两个键位由 use-graph-camera 的 window 监听处理(与界面焦点无关) */
const PRESS0 = `window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }))`;

/** 一帧点位的质心(读数 6 的"整理后着墨质心") */
function centroid(dots) {
  if (dots.length === 0) return null;
  const sx = dots.reduce((s, d) => s + d.x, 0);
  const sy = dots.reduce((s, d) => s + d.y, 0);
  return { x: Math.round(sx / dots.length), y: Math.round(sy / dots.length) };
}

/**
 * 后一帧里"动了"的点数:每个点找它在**前一帧**里的最近点,距离 > 5px 才算动。
 * 不用下标对齐:力导向会把点摊到视口外,后一帧的点集会变短(被裁剪),下标就错位了。
 */
function movedCount(a, b) {
  if (a.length === 0 || b.length === 0) return -1;
  let n = 0;
  for (const q of b) {
    let min = Infinity;
    for (const p of a) {
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < min) min = d;
    }
    if (min > 5) n += 1;
  }
  return n;
}

/**
 * 从"世界坐标表"与"画出来的点位表"反推把它们映上的那个相似变换,返回逐点残差的最大值。
 * 不猜视图相机(实测退出再进图时它适配的是径向布局而不是含记忆的点集,因为位置记忆是异步读回来的、
 * `useAutoFit` 只做一次),所以判据是:"画布上那一整张图的相对几何,到底是不是这份世界坐标集的相似像"。
 * 两张表按 `nodes` 遍历序一一对应(drawPlan 与探针同序;无裁剪时长度相等)。
 */
export function similarityResidual(world, dots) {
  if (world.length === 0 || world.length !== dots.length) return null;
  const span = (v) => Math.max(...v) - Math.min(...v);
  const wx = world.map((p) => p[0]);
  const dx = dots.map((d) => d.x);
  if (span(wx) === 0) return null;
  const k = span(dx) / span(wx);
  const avg = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  const tx = avg(dx) - k * avg(wx);
  const ty = avg(dots.map((d) => d.y)) - k * avg(world.map((p) => p[1]));
  let max = 0;
  for (let i = 0; i < world.length; i++) {
    const d = Math.hypot(k * world[i][0] + tx - dots[i].x, k * world[i][1] + ty - dots[i].y);
    if (d > max) max = d;
  }
  return { k: Math.round(k * 1000) / 1000, tx: Math.round(tx * 10) / 10, ty: Math.round(ty * 10) / 10, max: Math.round(max * 100) / 100 };
}

/**
 * 「整理布局」现场:点一下,一帧一帧数到停手,返回耗时 / 帧数 / 帧间隔 / 前后帧的点位。
 * 停手判定不只看文案:合成点击后 React 还没重渲染时按钮仍是「整理布局」,所以先等帧数真的涨起来
 * (frames >= 2)再看文案,免得把"还没开始"当成"已经跑完"。停手后再静置 700ms 数新增帧(应为 0)。
 */
const arrangeRun = (cdp) =>
  cdp.eval(`(async () => {
    const st = window.__g3;
    const scope = document.querySelector('[data-testid="graph-view"]');
    const find = (t) => [...scope.querySelectorAll('button')].find((x) => x.textContent.trim() === t);
    const btn = find('整理布局');
    if (btn === undefined) return null;
    const before = st.cur ?? st.last;
    const mark = st.t.length;
    const t0 = performance.now();
    btn.click();
    let seen = false;
    let ended = false;
    for (let i = 0; i < 1500; i++) {
      const running = find('整理中…') !== undefined;
      if (running) seen = true;
      else if (seen || st.t.length >= mark + 2) { ended = true; break; }
      await new Promise((r) => setTimeout(r, 4));
    }
    const ms = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 300)); // 让收尾那一帧先画完(停手与最后一次 setState 同一批)
    const stopMark = st.t.length;
    const after = st.cur ?? st.last;
    await new Promise((r) => setTimeout(r, 700));
    const t = st.t.slice(mark, stopMark);
    const gaps = [];
    for (let i = 1; i < t.length; i++) gaps.push(Math.round((t[i] - t[i - 1]) * 10) / 10);
    const sorted = [...gaps].sort((a, b) => a - b);
    const r1 = (v) => (v === undefined ? null : Math.round(v * 10) / 10);
    return {
      ms: Math.round(ms * 10) / 10, seen, ended, frames: t.length,
      median: r1(sorted[sorted.length >> 1]), max: r1(sorted[sorted.length - 1]),
      afterFrames: st.t.length - stopMark, stillArranging: find('整理中…') !== undefined,
      beforeDots: before === null ? [] : before.dots, afterDots: after === null ? [] : after.dots,
    };
  })()`);

export async function runDrag({ cdp, ev, ui, bm, record }) {
  await ev(PRESS0);
  await sleep(800);
  const posBefore = await bm.call('get_setting', { key: 'graph_positions' });
  const spot = await nodeSpot(cdp);
  const dx = 120;
  const dy = 90;
  let writeOk = false;
  let heldOk = false;
  let restoreOk = false;
  let detail = '取不到"半径最大且圆心命中自己"的靶点(相机不在适配档?)';
  if (spot !== null) {
    const from = { x: spot.originX + spot.local.x, y: spot.originY + spot.local.y };
    await pointerDrag(cdp, from.x, from.y, dx, dy);
    await sleep(700);
    const posRaw = await bm.call('get_setting', { key: 'graph_positions' });
    const pos = posRaw ? JSON.parse(posRaw) : {};
    const keys = Object.keys(pos);
    const want = { x: spot.world.x + dx / spot.k, y: spot.world.y + dy / spot.k };
    const got = pos[String(spot.id)] ?? null;
    writeOk = keys.length === 1 && keys[0] === String(spot.id) && got !== null &&
      Math.abs(got.x - want.x) <= 0.6 && Math.abs(got.y - want.y) <= 0.6;
    const writeText = `靶 id=${spot.id} ${spot.path}(命中半径 ${spot.r}px,起手点已由 hitTest 验证命中它本人;k=${Math.round(spot.k * 1000) / 1000});` +
      `拖 (${dx},${dy}) 后库值=${JSON.stringify(posRaw)},键 ${JSON.stringify(keys)}、世界坐标 (${got?.x},${got?.y})(期望 (${Math.round(want.x * 100) / 100},${Math.round(want.y * 100) / 100}) = 起点 + 屏幕位移/k)`;
    // 位置保持:退出再进图 -> 画布上那张图还应该是"含记忆"的世界坐标集的相似像
    await closeGraph(ui);
    await sleep(700);
    await armGraph(ui);
    await sleep(1400);
    const held = await worldPairs(cdp, spot.id);
    const frHeld = await lastFrame(cdp);
    const dots = frHeld?.dots ?? [];
    const resMem = held === null ? null : similarityResidual(held.pairs.map((p) => p.mem), dots);
    const resRaw = held === null ? null : similarityResidual(held.pairs.map((p) => p.raw), dots);
    heldOk = held?.hasKey === true && resMem !== null && resMem.max <= 2 && resRaw !== null && resRaw.max >= 20;
    // 复原库值:原值缺失时写空串(IPC 没有删除键的命令),parsePositions 对两者都得到空表
    await bm.call('set_setting', { key: 'graph_positions', value: posBefore ?? '' });
    await closeGraph(ui);
    await sleep(700);
    await armGraph(ui);
    await sleep(1400);
    const back = await worldPairs(cdp, spot.id);
    const frBacked = await lastFrame(cdp);
    const resBack = back === null ? null : similarityResidual(back.pairs.map((p) => p.raw), frBacked?.dots ?? []);
    const stored = await bm.call('get_setting', { key: 'graph_positions' });
    restoreOk = back?.hasKey === false && resBack !== null && resBack.max <= 2 && stored === (posBefore ?? '');
    detail = `${writeText};退出再进图:${dots.length} 个点对"含记忆"的坐标表残差最大 ${resMem?.max}px、对"纯径向"残差最大 ${resRaw?.max}px` +
      `(前者贴住、后者 ≥20px = 位置真的记住了;反推相机 k=${resMem?.k},三档对照:适配(含记忆) k=${held?.camMem.k} / 适配(纯径向) k=${held?.camRaw.k});` +
      `复原后库值=${JSON.stringify(stored)}(原值 ${JSON.stringify(posBefore ?? null)}),画布对纯径向残差最大 ${resBack?.max}px`;
  }
  record('G3-5 拖节点:位置记忆只含该 id、退出再进图保持、测后复原原值', writeOk && heldOk && restoreOk, detail);
}

export async function runArrange({ cdp, ev, record }) {
  await ev(PRESS0);
  await sleep(800);
  const run = await arrangeRun(cdp);
  const cBefore = centroid(run?.beforeDots ?? []);
  const cAfter = centroid(run?.afterDots ?? []);
  const moved = movedCount(run?.beforeDots ?? [], run?.afterDots ?? []);
  const budgetOk = run !== null && run.ms <= 1500 + 400;
  const perFrameOk = run !== null && run.frames >= 2 && run.max !== null && run.max <= 40;
  const stopOk = run !== null && run.stillArranging === false && run.afterFrames <= 1;
  record(
    'G3-6 「整理布局」:停手 ≤1.5s、逐帧不塌、停手后不再重绘',
    run !== null && run.ended === true && budgetOk && perFrameOk && stopOk && moved >= 100,
    run === null
      ? '找不到「整理布局」按钮'
      : `耗时 ${run.ms}ms(上限 1500ms + 一帧余量;${run.seen ? '看到过「整理中…」' : '轮询没赶上「整理中…」'});共 ${run.frames} 帧,帧间隔中位 ${run.median}ms / 最大 ${run.max}ms` +
        `(每帧预算 8ms -> 帧间隔不该塌成长阻塞);停手后又静置 700ms 再画 ${run.afterFrames} 帧(只允许收尾那一帧)、仍在整理=${run.stillArranging};` +
        `整理后着墨质心 (${cBefore?.x},${cBefore?.y}) -> (${cAfter?.x},${cAfter?.y})、相对前一帧真的换了位置的点 ${moved}/${(run.afterDots ?? []).length}`,
  );
  await ev(PRESS0);
  await sleep(800);
}
