#!/usr/bin/env node
/**
 * 关系图 G2 真机读数(计划 docs/superpowers/plans/2026-09-29-graph-g2.md 的 Task 7)。
 * 由 scripts/dev-graph-accept.mjs 在图内调用(在读数 5 之后、退出对账之前),不单独跑。
 *
 *   G2-1 悬停某节点 -> 邻居不弱化(1 + 邻居数) 非邻居 dim;气泡文案含路径与本级/含子级
 *   G2-2 单击 -> 右侧信息条出现且路径/计数正确
 *   G2-3 点「筛到信息流」-> 回信息流且条件栏有该标签 chip(随后复原条件并核对 filter_current 原文)
 *   G2-4 双击 -> 笔记小圆数 = min(notes, 20) 且 `+N` 正确
 *   G2-5 右键 -> 标签菜单出现且标题是该路径
 *   G2-6 搜索 -> Enter -> 该节点被选中(信息条路径正确)
 *   G2-7 搜索框里打 `-` -> 相机不变(画布不重绘);正对照:窗口级 `-` 会重绘(证明仪器看得出缩放)
 *   G2-8 只读:库计数/integrity/全量清单 + graph_positions 在本段交互前后一致
 *
 * 坐标一律用**容器局部坐标**换算成 client 坐标(clientX = 画布原点 + 画布局部坐标)——直接拿局部坐标
 * 当 clientX 会整体点偏一个容器原点(Task 5 审查留的话)。弱化只有 globalAlpha 一个可观测口径。
 * 执行顺序 1,2,4,5,6,7,3,8:G2-3 会切回信息流(排最后),G2-8 是对账必须收尾。
 */
import { sleep } from './cdp-lib.mjs';
import { dbCounts } from './no-tabs-accept-lib.mjs';
import {
  clickAt, doubleClickAt, focusSearch, graphGeom, installG2, keyPress, moveTo, NOTE_R, readFrame,
  rightClickAt, setSearchQuery, waitFrame,
} from './graph-accept-g2-lib.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 一帧的读数摘要:点(含 alpha)/ 笔记小圆 / `+N` 文案 / 帧序号 */
function brief(fr) {
  const hi = fr.dots.filter((d) => d.alpha > 0.9).length;
  const notes = fr.rings.filter((r) => Math.abs(r.r - NOTE_R) < 0.001).length;
  const plus = (fr.texts.find((t) => /^\+\d+$/.test(t.t)) ?? null)?.t ?? null;
  return { hi, dim: fr.dots.length - hi, dots: fr.dots.length, notes, plus, pushed: fr.pushed };
}

/** 点位的水平跨度:相机 k 变 f 倍,跨度也变 f 倍(k 不变 -> 跨度逐位相同) */
const spread = (fr) => {
  const xs = fr.dots.map((d) => d.x);
  return Math.round((Math.max(...xs) - Math.min(...xs)) * 100) / 100;
};

/** 等一个 DOM 条件成立(信息条/菜单都是渲染后才出现) */
async function waitDom(ev, expr, tries = 20, gap = 250) {
  for (let i = 0; i < tries; i++) {
    const v = await ev(expr);
    if (v) return v;
    await sleep(gap);
  }
  return null;
}

export async function runGraphG2({ cdp, ev, ui, bm, record }) {
  await installG2(cdp);
  const geom = await graphGeom(cdp);
  if (geom === null) {
    record('G2 前置:能读到源码模块(开发构建)', false, '生产构建没有源码模块路径,本段 8 条读数无法在装机版上跑');
    return;
  }
  const before = { counts: dbCounts(), inv: await bm.inventory(), info: await bm.call('get_db_info') };
  // 落点用探针算好的「避让点」:见得 graph-accept-g2-lib 的 aimOf(圆心会被相邻节点抢走)
  const spot = (t) => ({ x: geom.left + t.aim.x, y: geom.top + t.aim.y });
  console.log(`G2 几何:可见 ${geom.visible} 点 / ${geom.edges} 边(全库 ${geom.tags} 标签,折叠 ${geom.roots.join('、') || '(无)'});k=${geom.k};容器原点 (${geom.originX},${geom.originY}) 与画布差 (${geom.offsetX},${geom.offsetY})`);

  // 1) 悬停:邻居不弱化 / 非邻居弱化 + 气泡文案
  const hid = geom.hover;
  await moveTo(cdp, spot(hid).x, spot(hid).y);
  const hf = await waitFrame(cdp, (f) => brief(f).dim > 0, 12, 250);
  const hb = brief(hf);
  const tip = await waitDom(ev, `document.querySelector('[data-testid="hover-tip"]')?.textContent ?? null`);
  const wantHi = 1 + hid.neighbors;
  const tipOk = typeof tip === 'string' && tip.includes(hid.path) &&
    tip.includes(`本级 ${hid.selfCount}`) && tip.includes(`含子级 ${hid.notes}`);
  record(
    'G2-1 悬停:邻居不弱化/非邻居弱化 + 气泡文案',
    hb.dots === geom.visible && hb.hi === wantHi && hb.dim === geom.visible - wantHi && tipOk,
    `靶子 id=${hid.id} ${hid.path}(邻居 ${hid.neighbors};避让间距 ${hid.aim.gap}px);着 α=1 的点 ${hb.hi}(期望 1+${hid.neighbors}=${wantHi}),` +
      `α=0.2 的点 ${hb.dim}(期望 ${geom.visible - wantHi}),画布总点 ${hb.dots}/${geom.visible};气泡=「${tip}」`,
  );

  // 2) 单击 -> 信息条
  await clickAt(cdp, spot(hid).x, spot(hid).y);
  const bar = await waitDom(ev, `document.querySelector('[data-testid="graph-info-bar"]')?.textContent ?? null`);
  const barOk = typeof bar === 'string' && bar.includes(hid.path) &&
    bar.includes(`本级 ${hid.selfCount}`) && bar.includes(`含子级 ${hid.notes}`);
  record('G2-2 单击:右侧信息条出现且路径/计数正确', barOk, `信息条=「${bar}」(期望含 ${hid.path} / 本级 ${hid.selfCount} / 含子级 ${hid.notes})`);

  // 4) 双击 -> 展开笔记小圆 + `+N`(靶子已用 hitTest 校过「真的点得中」;这里再拿气泡确认一次)
  const big = geom.big;
  await moveTo(cdp, spot(big).x, spot(big).y);
  const bigTip = await waitDom(ev, `document.querySelector('[data-testid="hover-tip"]')?.textContent ?? null`);
  const bigHit = typeof bigTip === 'string' && bigTip.startsWith(big.path);
  await doubleClickAt(cdp, spot(big).x, spot(big).y);
  const nf = await waitFrame(cdp, (f) => brief(f).notes > 0, 20, 300);
  const nb = brief(nf);
  const wantDots = Math.min(big.notes, 20);
  const wantPlus = big.notes > 20 ? `+${big.notes - 20}` : null;
  record(
    'G2-4 双击:笔记小圆 = min(notes, 20) 且 +N 正确',
    bigHit && nb.notes === wantDots && (wantPlus === null || nb.plus === wantPlus),
    `靶子 id=${big.id} ${big.path}(含子级 ${big.notes};避让间距 ${big.aim.gap}px;靶前气泡=「${bigTip}」);笔记小圆 ${nb.notes}(期望 ${wantDots});` +
      `+N「${nb.plus}」(期望 ${wantPlus ?? '无,不超上限'});第一页取数即封顶 20`,
  );

  // 5) 右键 -> 标签菜单
  await rightClickAt(cdp, spot(hid).x, spot(hid).y);
  const title = await waitDom(ev, `document.querySelector('[data-tag-menu] p')?.textContent ?? null`);
  const items = (await ev(`document.querySelectorAll('[data-tag-menu] button[role="menuitem"]').length`)) ?? 0;
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await sleep(300);
  const closed = await ev(`!document.querySelector('[data-tag-menu]')`);
  record(
    'G2-5 右键:标签菜单出现且标题是该路径',
    title === hid.plain && items >= 5 && closed === true,
    `标题=「${title}」(期望纯文本 ${hid.plain};原始路径 ${hid.path});菜单项 ${items} 条;Esc 后已关=${closed === true}`,
  );

  // 6) 搜索 -> Enter -> 选中
  const leaf = geom.leaf;
  const focused = await focusSearch(cdp);
  await setSearchQuery(cdp, leaf.query);
  const hitRows = await waitDom(ev, `(() => { const n = document.querySelectorAll('[data-testid="graph-search-item"]').length; return n > 0 ? n : null; })()`);
  const first = await ev(`document.querySelector('[data-testid="graph-search-item"]')?.textContent ?? null`);
  const firstIsLeaf = first === leaf.plain;
  await keyPress(cdp, 'Enter', 'Enter', 13);
  const sbar = await waitDom(ev, `document.querySelector('[data-testid="graph-info-bar"]')?.textContent ?? null`);
  const cleared = await ev(`document.querySelector('[data-testid="graph-search-input"]').value === ''`);
  record(
    'G2-6 搜索 -> Enter:该节点被选中(信息条路径正确)',
    focused === true && hitRows !== null && firstIsLeaf && typeof sbar === 'string' &&
      sbar.includes(leaf.path) && cleared === true,
    `查询「${leaf.query}」(叶子 id=${leaf.id} ${leaf.path});候选 ${hitRows} 条,首条=「${first}」;` +
      `信息条=「${sbar}」;采纳后输入框已清空=${cleared === true}`,
  );

  // 7) 搜索框里打 `-`:守卫生效(相机不变 = 画布不重绘);正对照:窗口级 `-` 会重绘
  //    先迁到适配视图(window 派发,不受焦点影响):只有适配档整个可见集全在视口内,往外缩不跨裁剪边界,跨度才严格 ∝ k
  //    (T4.2 读数:适配档默认视图 = 357 点/711 边;旧值是 391 点)
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }))`);
  await sleep(800);
  await focusSearch(cdp);
  const pre = await readFrame(cdp); // 打字前的帧:本段的基准(适配档,无裁剪)
  await keyPress(cdp, '-', 'Minus', 189, '-');
  await keyPress(cdp, '-', 'Minus', 189, '-');
  await keyPress(cdp, '-', 'Minus', 189, '-');
  const typed = await ev(`document.querySelector('[data-testid="graph-search-input"]').value`);
  const post = await readFrame(cdp);
  // 打字期间一帧都不该重画(k 变必然重画,故「没重画」= 相机没动)
  const inBox = post.pushed === pre.pushed && spread(post) === spread(pre);
  await ev(`document.activeElement && document.activeElement.blur()`);
  await sleep(200);
  await keyPress(cdp, '-', 'Minus', 189, '-'); // 焦点离开输入框:同一下按键必须能缩放(正对照)
  const zoomed = (await waitFrame(cdp, (f) => f.pushed > post.pushed, 10, 250)) ?? post;
  const ratio = spread(zoomed) / spread(pre);
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }))`);
  await sleep(500);
  record(
    'G2-7 搜索框里打 `-` 不缩放画布(键盘守卫生效)',
    typed === '---' && inBox && zoomed.pushed > post.pushed && Math.abs(ratio - 1 / 1.15) < 0.03,
    `焦点在搜索框,输入框收到「${typed}」(证明按键真进了输入框):帧序号 ${pre.pushed}->${post.pushed}(不重绘)、` +
      `点位跨度 ${spread(pre)}->${spread(post)}(逐位相同 = 相机未动);正对照:失焦后窗口级「-」帧序号 ->${zoomed.pushed}、` +
      `跨度 ${spread(zoomed)}(k×${ratio.toFixed(3)},期望 ×0.870 = 1/1.15);随后已按 0 复位`,
  );

  // 3) 点「筛到信息流」-> 回信息流 + chip(随后复原并核对 filter_current 原文,给 8) 与读数 11 留干净现场)
  const filterBefore = await bm.call('get_setting', { key: 'filter_current' });
  const clicked = await ev(`(() => {
    const b = [...document.querySelectorAll('[data-testid="graph-info-bar"] button')].find((x) => x.textContent.trim() === '筛到信息流');
    if (!b) return false; b.click(); return true;
  })()`);
  await sleep(800);
  const inStream = await ev(`!document.querySelector('[data-testid="graph-view"] canvas')`);
  const chips = await ui.chips();
  const chipOk = chips.some((c) => c.replace('⊢ ', '') === '#' + leaf.path);
  const removed = await ev(`(() => {
    const b = [...document.querySelectorAll('[aria-label="已生效的筛选条件"] [aria-label^="移除条件"]')]
      .find((x) => (x.getAttribute('aria-label') || '').includes(${JSON.stringify(leaf.path)}));
    if (!b) return false; b.click(); return true;
  })()`);
  await sleep(900);
  const filterAfter = await bm.call('get_setting', { key: 'filter_current' });
  record(
    'G2-3 点「筛到信息流」:回信息流且条件栏有该标签 chip',
    clicked === true && inStream === true && chipOk && removed === true && same(filterBefore, filterAfter),
    `目标 ${leaf.path};已回信息流=${inStream === true};chips=${JSON.stringify(chips)}(含「⊢ #${leaf.path}」=${chipOk});` +
      `复原后 filter_current 原文一致=${same(filterBefore, filterAfter)}(写回是节流 500ms,已等 900ms)`,
  );

  // 8) 只读:本段交互前后库与清单逐项一致(含 graph_positions:进图不写位置)
  const after = { counts: dbCounts(), inv: await bm.inventory(), info: await bm.call('get_db_info') };
  const parts = [before.counts, before.inv, before.info].map((x, i) => same(x, [after.counts, after.inv, after.info][i]));
  record(
    'G2-8 只读:库计数/integrity/全量清单 + graph_positions 一致',
    parts.every(Boolean),
    `库计数 ${same(before.counts, after.counts)}(笔记 ${after.counts.notes} / 标签 ${after.counts.tags} / 链接 ${after.counts.links} / ` +
      `integrity=${after.counts.integrity});全量清单 ${same(before.inv, after.inv)};get_db_info ${same(before.info, after.info)};` +
      `graph_positions=${JSON.stringify(after.inv.graphPositions)};本条覆盖的交互:悬停/单击/双击展开/右键菜单/搜索跳转/筛到信息流(已复原)`,
  );
}
