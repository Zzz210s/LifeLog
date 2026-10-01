/**
 * 关系图 G3 真机读数的读数 1-4:四项过滤器 + 时间轴展开与 LOD 口径。
 * 由 graph-accept-g3.mjs 调用(过滤器面板只在这一段开着);判定与文案都在这里,主脚本只摆顺序。
 * 预测值一律由 graph-accept-g3-scene 的 `predict`(视图同一份纯函数)现算,不写死在脚本里 ——
 * 计划里的 391/751、768/1518 只当第二个口径(库变了才对不上,便于一眼看出是环境还是代码)。
 */
import { sleep } from './cdp-lib.mjs';
import { clickText, graphStatus, lastFrame, panelState, setFilterBox, setFilterSelect } from './graph-accept-g3-lib.mjs';
import { predict } from './graph-accept-g3-scene.mjs';

const STATUS = (n, e) => `${n} 个节点 / ${e} 条边`;
const MAX_DEPTH = 6;
/** 读数 1-4 的过滤器档位(与 useGraphFilters 的默认值同源:展开除折叠根外的全部轴) */
const filtersOf = (axes, over = {}) => ({ axes, maxDepth: MAX_DEPTH, onlyWithNotes: false, minNotes: 0, ...over });

async function waitStatus(cdp, want, tries = 24, gap = 250) {
  for (let i = 0; i < tries; i++) {
    const s = await graphStatus(cdp);
    if (s === want) return s;
    await sleep(gap);
  }
  return await graphStatus(cdp);
}

async function waitFrame(cdp, ok, tries = 24, gap = 250) {
  let f = null;
  for (let i = 0; i < tries; i++) {
    f = await lastFrame(cdp);
    if (f !== null && ok(f)) return f;
    await sleep(gap);
  }
  return f;
}

export async function runFilters({ cdp, record, base }) {
  const axesDefault = base.roots.filter((r) => !base.collapsed.includes(r));
  const wantDefault = STATUS(base.nodes.length, base.edgeCount);
  // 面板只在读数 1-4 期间开着
  await clickText(cdp, '过滤器');
  await sleep(400);

  // ---- 1) 取消勾选「地点」轴 -> 只留根、无悬空边;重置后恢复 ----
  const panel0 = await panelState(cdp);
  const fr0 = await lastFrame(cdp);
  const pNoPlace = await predict(cdp, filtersOf(axesDefault.filter((r) => r !== '地点')));
  const wantNoPlace = STATUS(pNoPlace.nodes.length, pNoPlace.edgeCount);
  const clickedOff = await setFilterBox(cdp, '展开轴 地点', false);
  await sleep(700);
  const panel1 = await panelState(cdp);
  const s1 = await waitStatus(cdp, wantNoPlace, 8);
  const fr1 = await lastFrame(cdp);
  const placeBox = panel1.axes.find((a) => a.root === '地点');
  const offOk = s1 === wantNoPlace && fr1?.fills === pNoPlace.nodes.length && fr1?.strokes === pNoPlace.edgeCount && placeBox?.checked === false;
  await clickText(cdp, '重置过滤器');
  await sleep(600);
  const sBack = await waitStatus(cdp, wantDefault, 8);
  const frBack = await lastFrame(cdp);
  const backOk = sBack === wantDefault && frBack?.fills === base.nodes.length && frBack?.strokes === base.edgeCount;
  record(
    'G3-1 取消勾选「地点」轴:只留该轴根、边不留悬空;重置后恢复',
    offOk && backOk && panel0.open === true,
    `取消前 ${panel0.axes.filter((a) => a.checked).length} 个轴勾着、画布 ${fr0?.fills} 点 / ${fr0?.strokes} 线;点了=${clickedOff};` +
      `取消后 勾选态=${placeBox?.checked}(期望 false)、状态条=${s1}(期望 ${wantNoPlace} = 预测 ${pNoPlace.nodes.length} 点 / ${pNoPlace.edgeCount} 边,悬空边已由 applyFilters 丢掉)、` +
      `画布 ${fr1?.fills} 点 / ${fr1?.strokes} 线;重置后 ${sBack}(画布 ${frBack?.fills} 点 / ${frBack?.strokes} 线,期望 ${wantDefault})。` +
      `勾选态若仍是 true,根因在 useGraphFilters 的 appeared 分支:它只看"不在 edited.axes 且不是折叠根",于是把"用户取消的轴"又当成"数据里新出现的根"加回 axes`,
  );

  // ---- 2) 深度上限 2 ----
  const pDepth = await predict(cdp, filtersOf(axesDefault, { maxDepth: 2 }));
  const wantDepth = STATUS(pDepth.nodes.length, pDepth.edgeCount);
  await setFilterSelect(cdp, '深度上限', 2);
  const s2 = await waitStatus(cdp, wantDepth, 8);
  const fr2 = await lastFrame(cdp);
  const panel2 = await panelState(cdp);
  record(
    'G3-2 深度上限 2:可见集最大 depth ≤ 2 且节点/边数正确',
    s2 === wantDepth && fr2?.fills === pDepth.nodes.length && fr2?.strokes === pDepth.edgeCount && pDepth.maxDepth === 2 && panel2.maxDepth === 2,
    `面板深度上限=${panel2.maxDepth};状态条 ${s2}(期望 ${wantDepth});画布 ${fr2?.fills} 点 / ${fr2?.strokes} 线;` +
      `预测可见集最大 depth=${pDepth.maxDepth}(≤2 由 applyFilters 的 depth 判据保证;点数与状态条同时对上 -> 视图确实用了这一档)`,
  );
  await clickText(cdp, '重置过滤器');
  await sleep(600);

  // ---- 3) 最少笔记数 20 + 「只显示有笔记」 ----
  const pMin = await predict(cdp, filtersOf(axesDefault, { minNotes: 20 }));
  const wantMin = STATUS(pMin.nodes.length, pMin.edgeCount);
  await setFilterSelect(cdp, '最少笔记数', 20);
  const s3 = await waitStatus(cdp, wantMin, 8);
  const fr3 = await lastFrame(cdp);
  const pMinOnly = await predict(cdp, filtersOf(axesDefault, { minNotes: 20, onlyWithNotes: true }));
  const wantMinOnly = STATUS(pMinOnly.nodes.length, pMinOnly.edgeCount);
  await setFilterBox(cdp, '只显示有笔记的标签', true);
  await sleep(700);
  const s3b = await waitStatus(cdp, wantMinOnly, 8);
  const panel3 = await panelState(cdp);
  record(
    'G3-3 最少笔记数 20:只剩大标签;「只显示有笔记」不误杀',
    s3 === wantMin && fr3?.fills === pMin.nodes.length && fr3?.strokes === pMin.edgeCount && panel3.minNotes === 20 &&
      s3b === wantMinOnly && wantMinOnly === wantMin && base.zeroNote === 0,
    `最少笔记数=${panel3.minNotes}/只显示有笔记=${panel3.onlyWithNotes}:${s3} -> ${s3b}(期望 ${wantMin};画布 ${fr3?.fills} 点 / ${fr3?.strokes} 线 —— 边数等于点数说明只剩大标签);` +
      `计划里写的档位 500 在 T1 定型时改成了 0/1/5/20(MIN_NOTES_CHOICES),这里用面板能选的 20;` +
      `本机库 ${base.tags} 个标签里 0 笔记的有 ${base.zeroNote} 个 -> 这一档这次只证明"不误杀",筛掉空标签的能力没有真机对象可验`,
  );
  await clickText(cdp, '重置过滤器');
  await sleep(600);

  // ---- 4) 勾上「时间」轴 + LOD 枢纽文字按本级口径 ----
  const pTime = await predict(cdp, filtersOf([...axesDefault, '时间']));
  const wantTime = STATUS(pTime.nodes.length, pTime.edgeCount);
  await setFilterBox(cdp, '展开轴 时间', true);
  const s4 = await waitStatus(cdp, wantTime, 16, 300);
  const fr4 = await waitFrame(cdp, (f) => f.fills === pTime.nodes.length, 16, 300);
  const drawn = fr4?.labels ?? [];
  const maxOf = (pick) => {
    const m = new Map();
    for (const n of pTime.nodes) m.set(n.leaf, Math.max(m.get(n.leaf) ?? 0, pick(n)));
    return m;
  };
  const selfOf = maxOf((n) => n.selfCount);
  const notesOf = maxOf((n) => n.notes);
  const badSelf = drawn.filter((t) => (selfOf.get(t) ?? 0) < 100).length;
  const badNotes = drawn.filter((t) => (notesOf.get(t) ?? 0) < 100).length;
  const lod = fr4 === null ? '无帧' : drawn.length === fr4.fills ? '全量文字' : drawn.length === 0 ? '只有点' : '枢纽文字';
  const lodOk = lod === '全量文字' || lod === '只有点' || badSelf === 0;
  const drawnOk = fr4?.fills === pTime.nodes.length ? fr4.strokes === pTime.edgeCount : (fr4?.fills ?? 0) <= pTime.nodes.length;
  record(
    'G3-4 勾上「时间」轴:391 -> 768 节点、751 -> 1518 边;枢纽文字按本级口径',
    s4 === wantTime && wantTime === STATUS(768, 1518) && lodOk && drawnOk,
    `状态条 ${s4}(期望 ${wantTime} = 计划里的 768 / 1518);画布 ${fr4?.fills} 点 / ${fr4?.strokes} 线${(fr4?.fills ?? 0) < 768 ? '(不足 768 = 视口裁剪,判据仍看状态条与纯函数预测)' : ''};` +
      `LOD=${lod}:画出文字 ${drawn.length} 条,其中"本级 selfCount < 100"的 ${badSelf} 条、"含子级 notes < 100"的 ${badNotes} 条` +
      `(badSelf=0 = 文字全落在真枢纽上;若 badSelf>0 而 badNotes=0,说明回退成了含子级口径 —— 正是 T2 收掉的旧债)`,
  );
  await clickText(cdp, '重置过滤器');
  await sleep(600);
  await clickText(cdp, '过滤器'); // 收起面板:后面两个读数只碰画布/工具栏
  await sleep(400);
}
