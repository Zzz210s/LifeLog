/**
 * 关系图 G3 真机读数 10(2026-10-01 遗留清理轮新增):位置记忆的**修剪**。
 *
 * 修剪是**写回时**做的(`use-graph-camera` 的 `commitPositions`:读旧值 -> 与本地已知位置合并 ->
 * 按现存标签修剪 -> 写回),所以「删标签再进图」本身**不会**修剪(进图只读一次设置)—— 这条读数
 * 把两件事都读出来:删标签 -> 重进图 -> 那条**还在**;再拖一个节点触发一次写回 -> 那条被清掉。
 *
 * 纪律:只动自建标签(`CEP测试` 子树)与自建笔记,收尾把 `graph_positions` 原文还原、自建数据删净,
 * 并用「笔记 id 清单 / 全量标签路径 / 位置记忆原文」与开工前对账(用户的 `820` 条目原样保留)。
 * 两个拖靶都是自建叶子,**深度取 6**:本机库最深就是 6 层,而默认深度上限也是 6
 * (第一版取深度 7 —— 直接被 `applyFilters` 的 `maxDepth` 筛掉,靶点在可见集里根本不存在)。
 * B 的笔记**先于**删 A 建好:B 的 rowid 比 A 大,删 A 之后 B 才不会复用 A 的 id
 * (实测 `tags.id` 是 rowid,删掉最大 id 后下一条插入会把它捡回去,读数就分不清谁是谁了)。
 */
import { sleep } from './cdp-lib.mjs';
import { armGraph, closeGraph } from './graph-accept-lib.mjs';
import { clickAt, pointerDrag } from './graph-accept-g3-lib.mjs';
import { blankPoint, nodeSpot, predict } from './graph-accept-g3-scene.mjs';

const PRESS0 = `window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }))`;
/** 自建命名空间:本读数只碰这一棵子树 */
const ROOT = 'CEP测试';
/** 叶子路径(深度 6 = 库内最深,也是默认深度上限) */
const LEAF = '一/二/三/四';
/** 先拖它、再删它:它的条目应当在**下一次写回**时被修剪掉 */
const A = `${ROOT}/位置记忆/${LEAF}`;
/** 删掉 A 之后拖它:这一次写回就是被观察的"下一次" */
const B = `${ROOT}/触发写入/${LEAF}`;
const DX = 120;
const DY = 90;

const parse = (raw) => JSON.parse(raw || '{}');
const keysOf = (raw) => Object.keys(parse(raw)).sort();
const hasKey = (raw, id) => Object.prototype.hasOwnProperty.call(parse(raw), String(id));

/** 等一个标签在/不在 list_tags 里(建笔记与删标签都是同步 IPC,这里只是等回包落地) */
async function waitPath(bm, path, want) {
  for (let i = 0; i < 20; i++) {
    if ((await bm.paths()).includes(path) === want) return true;
    await sleep(300);
  }
  return false;
}

/** 建一条自建笔记(正文里的 `#路径` 会自动建树)并等它的标签出现;返回笔记 id */
async function makeNote(bm, path) {
  const note = await bm.call('save_input_note', { content: `位置记忆修剪夹具 #${path}` });
  await waitPath(bm, path, true);
  return note.id;
}

/** 标签 id(按路径现查,别猜) */
const tagId = async (bm, path) => (await bm.call('list_tags')).find((t) => t.path === path)?.id ?? null;

/** 进图并回适配档(`nodeSpot` 与 `blankPoint` 的口径只在适配档下等于视图相机) */
async function enterFit({ ev, ui }) {
  await armGraph(ui);
  await sleep(1800);
  await ev(PRESS0);
  await sleep(800);
}

/** 退出关系图前先清选中:有选中时 `Esc` 会变成「带该标签回信息流」(会写 filter_current,破坏只读对账) */
async function leaveGraph({ cdp, ev, ui }) {
  await ev(PRESS0);
  await sleep(800);
  const blank = await blankPoint(cdp); // 适配档下算出来的空白点(与视图同一份命中算式)
  if (blank !== null) await clickAt(cdp, blank.x, blank.y);
  await sleep(400);
  await closeGraph(ui);
  await sleep(600);
}

/**
 * 拖一个自建靶点 (DX,DY),等这次写回落库。
 * 靶点用 `nodeSpot` 验过「圆心真的命中它自己」,点不中时回 null(判定里报不可判定,不悄悄换靶)。
 */
async function dragNode({ cdp, ev, bm, id }) {
  const spot = await nodeSpot(cdp, id);
  if (spot === null) return { spot: null, pos: null };
  await pointerDrag(cdp, spot.originX + spot.local.x, spot.originY + spot.local.y, DX, DY);
  let pos = null;
  for (let i = 0; i < 10; i++) {
    pos = await bm.call('get_setting', { key: 'graph_positions' });
    if (hasKey(pos, id)) break;
    await sleep(250);
  }
  return { spot, pos };
}

export async function runPrune({ cdp, ev, ui, bm, record }) {
  const posBefore = await bm.call('get_setting', { key: 'graph_positions' });
  const baseKeys = keysOf(posBefore);
  const invBefore = await bm.inventory();

  // 0) 两条自建笔记先都建好(见文件头:B 的 id 必须大于 A 的)
  await leaveGraph({ cdp, ev, ui });
  const noteA = await makeNote(bm, A);
  const noteB = await makeNote(bm, B);
  const idA = await tagId(bm, A);
  const idB = await tagId(bm, B);
  const idsOk = idA !== null && idB !== null && idA !== idB;

  // 1) 拖 A:位置记忆 = 基线 + 它自己(「只有它」是相对基线说的:本机基线里已有用户的 820 条目)
  await enterFit({ ev, ui });
  const first = idsOk ? await dragNode({ cdp, ev, bm, id: idA }) : { spot: null, pos: null };
  const keys1 = keysOf(first.pos);
  const want1 = [...baseKeys, String(idA)].sort();
  const wrote1 = first.spot !== null && JSON.stringify(keys1) === JSON.stringify(want1);
  const movedOk =
    first.spot !== null && first.pos !== null && hasKey(first.pos, idA) &&
    Math.abs(parse(first.pos)[String(idA)].x - (first.spot.world.x + DX / first.spot.k)) <= 0.6 &&
    Math.abs(parse(first.pos)[String(idA)].y - (first.spot.world.y + DY / first.spot.k)) <= 0.6;

  // 2) 删 A -> 重进图:条目**还在**(进图只读设置,不写回;修剪只在写回时做)
  await leaveGraph({ cdp, ev, ui });
  await bm.call('delete_tag', { tagId: idA });
  await waitPath(bm, A, false);
  await enterFit({ ev, ui });
  const view = await predict(cdp, null);
  const goneFromGraph = view !== null && !view.nodes.some((n) => n.id === idA);
  const posKeep = await bm.call('get_setting', { key: 'graph_positions' });
  const keptBeforeWrite = hasKey(posKeep, idA);

  // 3) 就在图里拖 B(它先建的,一直在可见集里)-> 触发写回 -> A 的条目被修剪(基线 + B,A 不在其中)
  const second = idsOk ? await dragNode({ cdp, ev, bm, id: idB }) : { spot: null, pos: null };
  const keys2 = keysOf(second.pos);
  const want2 = [...baseKeys, String(idB)].sort();
  const pruned = second.spot !== null && JSON.stringify(keys2) === JSON.stringify(want2) && !hasKey(second.pos, idA);

  // 4) 收尾:还原位置记忆原文 + 删净自建笔记与标签 + 库存对账 + 回到图内适配档
  await leaveGraph({ cdp, ev, ui });
  await bm.call('set_setting', { key: 'graph_positions', value: posBefore ?? '' });
  for (const id of [noteA, noteB]) await bm.call('delete_note', { id });
  await sleep(600);
  const base = new Set(invBefore.paths);
  const mine = (await bm.call('list_tags'))
    .filter((t) => !base.has(t.path) && (t.path === ROOT || t.path.startsWith(ROOT + '/')))
    .sort((a, b) => b.depth - a.depth);
  for (const t of mine) await bm.call('delete_tag', { tagId: t.id });
  await sleep(600);
  const invAfter = await bm.inventory();
  const restored = invAfter.graphPositions === (posBefore ?? '');
  const cleanOk =
    JSON.stringify(invAfter.ids) === JSON.stringify(invBefore.ids) &&
    JSON.stringify(invAfter.paths) === JSON.stringify(invBefore.paths) && restored;
  await armGraph(ui);
  await sleep(1500);
  await ev(PRESS0);
  await sleep(600);

  const s = (v) => (v === null ? 'null' : JSON.stringify(v));
  record(
    'G3-10 位置记忆修剪:删标签后下一次写回清掉该条目(进图本身不修剪)',
    idsOk && wrote1 && movedOk && goneFromGraph && keptBeforeWrite && pruned && cleanOk,
    !idsOk
      ? `自建标签 id 取不到或撞车(A=${idA} / B=${idB})`
      : first.spot === null || second.spot === null
        ? `靶点取不到(自建深度 6 的环上还有别的点?)A 命中=${first.spot !== null} B 命中=${second.spot !== null}`
        : `自建 ${ROOT} 子树(A ${A} id=${idA} / B ${B} id=${idB});基线位置记忆键 ${s(baseKeys)} 原文 ${s(posBefore)};` +
          `① 拖 A(k=${Math.round(first.spot.k * 1000) / 1000}):库键 ${s(keys1)} = 基线 + A=${wrote1}、` +
          `落点与「起点 + 屏幕位移/k」一致=${movedOk};` +
          `② 删 A 后重进图:可见集里 A 已不在=${goneFromGraph}、条目**仍在**=${keptBeforeWrite}(进图不写回,修剪只在写回时做);` +
          `③ 拖 B 触发写回:库键 ${s(keys2)} = 基线 + B=${JSON.stringify(keys2) === JSON.stringify(want2)}、` +
          `A 的条目已被修剪=${!hasKey(second.pos, idA)};` +
          `④ 收尾:位置记忆原文还原=${restored}、笔记 id 清单/标签路径与开工前一致=${cleanOk}(删净 ${mine.length} 个自建标签 + 2 条笔记)`,
  );
}
