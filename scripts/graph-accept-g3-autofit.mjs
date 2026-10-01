/**
 * 关系图 G3 真机读数 9(修复轮新增):进图两次的相机适配一致。
 *
 * `collapsedRoots` 是异步读设置,而 `useAutoFit` 只适配一次 —— 不等它就会拿「没折叠」的全量落点算 fit
 * (T7a 实测:第一次进图 k=0.949 正确,退出再进图 k=0.751/411/304.2 偏心)。
 * 判据不猜相机:用读数 5 同一套「从画布点位反推相似变换」,比 A(按过 `0` 的适配档 = 正确值基准)
 * 与 B(退出再进图后的自动适配)的 k/tx/ty,再要求 B 等于纯函数算出的 camRaw = fitToView(折叠后布局)。
 * B 这一档**不能**按 `0` —— 按了就绕开"进图自动适配"这条竞态路径了。
 */
import { sleep } from './cdp-lib.mjs';
import { armGraph, closeGraph } from './graph-accept-lib.mjs';
import { lastFrame } from './graph-accept-g3-lib.mjs';
import { worldPairs } from './graph-accept-g3-scene.mjs';
import { similarityResidual } from './graph-accept-g3-stage.mjs';

const PRESS0 = `window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }))`;
const r3 = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
const near = (a, b, eps) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= eps;

/**
 * 量一次「画布上的相似变换」:纯径向布局**叠上库里的位置记忆**(用户拖过的节点)对画出来的点位。
 * 比的是**有效落点表**(`mem`):库里位置记忆非空时画布本来就该画那些记过的位置 —— 拿纯径向表比
 * 会把用户自己记过的节点当成错位(实测用户的 `820` 条目离它的径向位置 5.6px,旧判据在真机上会假红);
 * 位置记忆为空时 `mem` 与 `raw` 逐位相同,这条口径就退化成原来的“对纯径向布局”。
 */
async function measure(cdp) {
  const w = await worldPairs(cdp, -1);
  const fr = await lastFrame(cdp);
  const dots = fr?.dots ?? [];
  const res = w === null ? null : similarityResidual(w.pairs.map((p) => p.mem), dots);
  return { res, dots: dots.length, visible: w?.visible, camFit: w?.camMem };
}

export async function runAutoFit({ cdp, ev, ui, record }) {
  // A:按 `0` 回适配档。适配算式只有一份,补上折叠后的落点 —— 这就是"正确值"的基准。
  await ev(PRESS0);
  await sleep(900);
  const a = await measure(cdp);

  // B:退出再进图,走"进图自动适配"这条竞态路径;等数据与折叠根都落定
  await closeGraph(ui);
  await sleep(600);
  await armGraph(ui);
  await sleep(1800);
  const b = await measure(cdp);

  const sameCam =
    a.res !== null && b.res !== null && near(a.res.k, b.res.k, 0.005) && near(a.res.tx, b.res.tx, 1) && near(a.res.ty, b.res.ty, 1);
  const fitOk =
    b.res !== null && b.camFit !== null && near(b.res.k, b.camFit.k, 0.005) && near(b.res.tx, b.camFit.tx, 1) && near(b.res.ty, b.camFit.ty, 1);
  const residualOk = a.res !== null && b.res !== null && a.res.max <= 2 && b.res.max <= 2;
  record(
    'G3-9 进图两次的相机适配一致(折叠根就绪才适配)',
    sameCam && fitOk && residualOk,
    `A(按 0 的适配档)k=${r3(a.res?.k)}/tx=${r3(a.res?.tx)}/ty=${r3(a.res?.ty)}、${a.dots} 点(可见 ${a.visible})、残差 ${a.res?.max}px;` +
      `B(退出再进图,不按 0)k=${r3(b.res?.k)}/tx=${r3(b.res?.tx)}/ty=${r3(b.res?.ty)}、${b.dots} 点(可见 ${b.visible})、残差 ${b.res?.max}px;` +
      `纯函数适配(折叠后布局 + 位置记忆)camFit k=${r3(b.camFit?.k)}/tx=${r3(b.camFit?.tx)}/ty=${r3(b.camFit?.ty)};` +
      `A 与 B 一致=${sameCam}、B 等于纯函数适配=${fitOk}。修复前这一档会是未折叠 768 点布局的 fit(k=0.751/411/304.2,画面更缩且偏心)`,
  );
}
