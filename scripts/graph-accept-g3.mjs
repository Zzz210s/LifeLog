/**
 * 关系图 G3 真机读数(计划 docs/superpowers/plans/2026-10-01-graph-g3.md 的 Task 7)的入口。
 * 由 scripts/dev-graph-accept.mjs 在图内调用(G1 读数 5 之后、G2 八条之前),不单独跑。
 * 十条读数的实现分五处,本文件只摆顺序、给共享基线、最后对账(行数红线 200 逼出来的拆法):
 *
 *   graph-accept-g3-filter.mjs   1-4  四项过滤器 + 时间轴展开与 LOD 口径
 *   graph-accept-g3-stage.mjs   5-6  拖节点 + 位置记忆 / 「整理布局」现场测量
 *   graph-accept-g3-reload.mjs  7    侧栏改名 -> 版本变化自动重载,相机与选中保留
 *   graph-accept-g3-autofit.mjs  9    进图两次的相机适配一致(折叠根就绪才适配)
 *   graph-accept-g3-prune.mjs   10   位置记忆修剪:删标签后下一次写回清掉该条目
 *   本文件                       8    只读对账(graph_positions 走空值等价)
 *   页面侧探针:graph-accept-g3-lib.mjs(装机计数器/面板与工具栏/合成事件)
 *               graph-accept-g3-scene.mjs(用视图同一份纯函数重算可见集与靶点)
 *
 * 坐标口径:指针事件一律吃 client 坐标 = 容器原点 + 画布局部坐标(G2 Task 5 审查留的话);
 * 场景相机只在视图处于适配档时等于真相机,所以读数 5/6/7 都先按 `0` 再取靶点。
 */
import { sleep } from './cdp-lib.mjs';
import { dbCounts } from './no-tabs-accept-lib.mjs';
import { clickAt, clickText, graphStatus, installG3, invSame, lastFrame, panelState, setSearch } from './graph-accept-g3-lib.mjs';
import { blankPoint, predict } from './graph-accept-g3-scene.mjs';
import { runFilters } from './graph-accept-g3-filter.mjs';
import { runAutoFit } from './graph-accept-g3-autofit.mjs';
import { runArrange, runDrag } from './graph-accept-g3-stage.mjs';
import { runPrune } from './graph-accept-g3-prune.mjs';
import { runReload } from './graph-accept-g3-reload.mjs';

const STATUS = (n, e) => `${n} 个节点 / ${e} 条边`;
/** `0` 由 use-graph-camera 的 window 监听处理(回适配档 + 作废整理结果) */
const PRESS0 = `window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }))`;

export async function runGraphG3({ cdp, ev, ui, bm, record }) {
  await installG3(cdp);
  // 前置:相机回适配档(G1 读数 5 收尾刚按过 `0`,这里再按一次把读数之间的互相踩抹平)
  await ev(PRESS0);
  await sleep(800);
  const base = await predict(cdp, null);
  if (base === null) {
    record('G3 前置:能读到源码模块(开发构建)', false, '生产构建没有源码模块路径,本段 10 条读数无法在装机版上跑');
    return;
  }
  const filterCurrent = await bm.call('get_setting', { key: 'filter_current' });
  const before = { counts: dbCounts(), inv: await bm.inventory(), info: await bm.call('get_db_info') };
  console.log(`G3 基线:${STATUS(base.nodes.length, base.edgeCount)}(全库 ${base.tags} 标签,折叠 ${base.collapsed.join('、') || '(无)'},位置记忆条目 ${base.savedKeys})`);

  await runAutoFit({ cdp, ev, ui, record });
  await runFilters({ cdp, record, base });
  await runDrag({ cdp, ev, ui, bm, record });
  await runArrange({ cdp, ev, record });
  await runReload({ cdp, ev, ui, bm, record, base, filterCurrent });
  await runGraphViz({ cdp, ev, record }); // 视觉重做三条读数(聚合/着色/放大锚点)
  // 自建标签 + 自建笔记的读数:跑在最后(它建/删标签会改可见集,别踩前面的读数)
  await runPrune({ cdp, ev, ui, bm, record });

  // ---- 收尾:面板收起、清选中、清搜索、回适配档(G2 八条从"适配档 + 无选中 + 默认过滤"起跑) ----
  if ((await panelState(cdp)).open) {
    await clickText(cdp, '过滤器');
    await sleep(400);
  }
  const blank = await blankPoint(cdp);
  if (blank !== null) await clickAt(cdp, blank.x, blank.y);
  await setSearch(cdp, '');
  await ev(PRESS0);
  await sleep(900);
  const stillOpen = (await panelState(cdp)).open;
  const noBar = (await cdp.eval(`document.querySelector('[data-testid="graph-info-bar"]') === null`)) === true;
  const status = await graphStatus(cdp);
  const fr = await lastFrame(cdp);
  console.log(
    `G3 收尾:面板 open=${stillOpen}、信息条已收=${noBar}、相机回适配档(清选中的空白点${blank === null ? '没找到' : '已点'});` +
      `状态条 ${status}(画布 ${fr?.fills} 点 / ${fr?.strokes} 线)`,
  );

  // ---- 8) 只读对账 ----
  const after = { counts: dbCounts(), inv: await bm.inventory(), info: await bm.call('get_db_info') };
  const countsOk = JSON.stringify(before.counts) === JSON.stringify(after.counts);
  const infoOk = JSON.stringify(before.info) === JSON.stringify(after.info);
  record(
    'G3-8 只读对账:库计数/全量清单/get_db_info 与进段前一致(graph_positions 例外,测后已复原)',
    countsOk && invSame(before.inv, after.inv) && infoOk,
    `库计数 ${countsOk}(笔记 ${after.counts.notes} / 标签 ${after.counts.tags} / 链接 ${after.counts.links} / 别名 ${after.counts.aliases} / integrity=${after.counts.integrity};开工前同项 ${JSON.stringify(before.counts)});` +
      `清单逐项 ${invSame(before.inv, after.inv)};get_db_info ${infoOk};graph_positions ${JSON.stringify(before.inv.graphPositions)} -> ${JSON.stringify(after.inv.graphPositions)}` +
      `(空值等价:null / '' / {} 都解析成空表 —— IPC 没有删除键的命令,原值缺失时只能写回空串);` +
      `本段动过库的只有"拖节点 + 复原"与"改名 + 改回";面板已收起=${stillOpen === false}、信息条已收=${noBar}`,
  );
}
