// 关系图 G3 真机读数的「场景」探针(自 graph-accept-g3-lib 拆出,两个文件各守 200 行红线):
// 用**视图同一份纯函数**(applyFilters / radialLayout / fitToView / hitTest / parse+applyPositions)
// 在页面里重算可见集、落点与适配相机,好把"预测值"和"画布上真画出来的东西"放在一起比。
// 判定一条都不留在这里(全在 graph-accept-g3.mjs),这里只回结构化读数。
//
// 两个前提写死在调用方(读数 2/4/5/7 之间会互相踩,故每次进读数前都先按 `0` 回适配档):
// ① 场景相机 = `fitToView` —— 只在视图真的处于适配档时才等于真相机(读数 5/7 都先按了 `0`);
// ② 过滤器取视图的**默认值**(`defaultFilters(roots, collapsedRoots)`),调用方要别的档就显式传。
// 场景对象不能直接回 Node(Map 过不了 returnByValue),所以每个探针自己嵌 SCENE 再取纯数据。

/** 场景构造源码(内联进每个探针的 async IIFE 里;`FILTERS` 由外层作用域提供,null = 视图默认档) */
const SCENE = `(async () => {
  const mods = await Promise.all([
    import('/src/main-window/graph/radial.ts'),
    import('/src/main-window/graph/graph-filters.ts'),
    import('/src/main-window/graph/graph-draw-plan.ts'),
    import('/src/main-window/graph/graph-camera.ts'),
    import('/src/main-window/graph/graph-hit.ts'),
    import('/src/main-window/graph/graph-positions.ts'),
    import('/src/main-window/graph/graph-view-model.ts'),
    import('/src/main-window/settings/time-tag-settings.ts'),
  ]).catch(() => null);
  if (mods === null) return null;
  const [radial, gf, dp, camera, hit, hpos, vm, tt] = mods;
  const T = window.__TAURI_INTERNALS__.invoke;
  const raw = await T('graph_data');
  const tpl = tt.normalizeTemplate(await T('get_setting', { key: 'time_tag_template' }));
  const roots = gf.axisOptions(raw);
  const collapsed = vm.collapseRootsOf(tpl);
  const filters = FILTERS === null ? gf.defaultFilters(roots, collapsed) : FILTERS;
  const view = gf.applyFilters(raw, filters);
  const layout = radial.radialLayout(view.nodes, { layerGap: 90 });
  const savedRaw = await T('get_setting', { key: 'graph_positions' });
  const saved = hpos.parsePositions(savedRaw === undefined ? null : savedRaw);
  const points = hpos.applyPositions(layout, saved);
  const el = document.querySelector('[data-testid="graph-view"]');
  if (el === null) return null;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(el.clientWidth * dpr) / dpr;
  const h = Math.round(el.clientHeight * dpr) / dpr;
  const cam = camera.fitToView([...points.values()], w, h);
  return { radial, gf, dp, camera, hit, hpos, vm, tt, raw, roots, collapsed, filters, view, layout, saved, points, el, dpr, w, h, rect: el.getBoundingClientRect(), cam };
})()`;

const round = 'const r2 = (v) => Math.round(v * 100) / 100;';
const leaf = 'const leafOf = (p) => p.split("/").pop();';

/**
 * 预测给定过滤器下的可见集与绘制量(应用侧真值 === 视图侧纯函数)。
 * 回:节点表(带 depth / notes(含子级)/ selfCount(本级)/ leaf)、边数、最大 depth、根与折叠根、
 * 空态、全库标签数与**0 笔记标签数**(读数 3 的"只显示有笔记"在本机库无对象可筛这点靠它说明)。
 */
export const predict = (cdp, filters) =>
  cdp.eval(`(async () => {
    const FILTERS = ${JSON.stringify(filters ?? null)};
    const S = await ${SCENE};
    if (S === null) return null;
    ${round}
    ${leaf}
    return {
      nodes: S.view.nodes.map((n) => ({ id: n.id, path: n.path, depth: n.depth, notes: n.notes, selfCount: n.selfCount, leaf: leafOf(n.path) })),
      edgeCount: S.view.edges.length,
      maxDepth: S.view.nodes.reduce((m, n) => Math.max(m, n.depth), 0),
      roots: S.roots,
      collapsed: S.collapsed,
      filters: S.filters,
      empty: S.view.empty,
      tags: S.raw.nodes.length,
      zeroNote: S.raw.nodes.filter((n) => n.notes <= 0).length,
      savedKeys: Object.keys(S.saved).length,
    };
  })()`);

/**
 * 空白起手点(画布局部 + client 两套坐标):先用 `hitTest` 证明**没命中任何节点**,再要求离最近的点
 * 30px 以上 —— G1 读数 5 的"拖空白平移"原先写死 client (500,350),G3 起那里可能正好落在节点上
 * (命中就变成**拖节点**:质心不动、读数红,而且真会写 graph_positions)。
 * 回 null 表示网格上找不到(调用方应报不可判定,不要退回写死坐标)。
 */
export const blankPoint = (cdp) =>
  cdp.eval(`(async () => {
    const FILTERS = null;
    const S = await ${SCENE};
    if (S === null) return null;
    ${round}
    const screens = S.view.nodes.map((n) => {
      const p = S.points.get(n.id);
      return p === undefined ? null : S.camera.screenOf(p, S.cam);
    });
    for (let gy = 1; gy <= 7; gy++) {
      for (let gx = 1; gx <= 9; gx++) {
        const x = (S.w * gx) / 10;
        const y = (S.h * gy) / 8;
        if (S.hit.hitTest({ nodes: S.view.nodes, points: S.points, cam: S.cam, x, y }) !== null) continue;
        let far = true;
        for (const s of screens) if (s !== null && Math.hypot(s.x - x, s.y - y) < 30) { far = false; break; }
        if (!far) continue;
        return { local: { x: r2(x), y: r2(y) }, x: r2(S.rect.left + x), y: r2(S.rect.top + y),
          originX: r2(S.rect.left), originY: r2(S.rect.top), k: S.cam.k, visible: S.view.nodes.length };
      }
    }
    return null;
  })()`);

/**
 * 靶节点(拖节点与读数 7 的选中靶):圆心 `hitTest` 真的命中它自己的那个点里,挑屏上半径最大者
 * (半径最大 = 最好点中)。给了 id 就固定取那个节点(id 点不中则回 null,不悄悄换靶)。
 * 回:世界坐标(布局+记忆那一份)、画布局部圆心、容器原点、相机 k、可见点数、记忆条目数。
 */
export const nodeSpot = (cdp, id = null) =>
  cdp.eval(`(async () => {
    const FILTERS = null;
    const WANT = ${id === null ? 'null' : JSON.stringify(id)};
    const S = await ${SCENE};
    if (S === null) return null;
    ${round}
    let best = null;
    for (const n of S.view.nodes) {
      if (WANT !== null && n.id !== WANT) continue;
      const p = S.points.get(n.id);
      if (p === undefined) continue;
      const s = S.camera.screenOf(p, S.cam);
      if (S.hit.hitTest({ nodes: S.view.nodes, points: S.points, cam: S.cam, x: s.x, y: s.y }) !== n.id) continue;
      const r = S.dp.radiusOf(n.notes);
      if (best === null || r > best.r) best = { n, p, s, r };
    }
    if (best === null) return null;
    return {
      id: best.n.id, path: best.n.path, notes: best.n.notes, r: r2(best.r),
      world: { x: r2(best.p.x), y: r2(best.p.y) }, local: { x: r2(best.s.x), y: r2(best.s.y) },
      originX: r2(S.rect.left), originY: r2(S.rect.top), k: S.cam.k,
      visible: S.view.nodes.length, savedKeys: Object.keys(S.saved).length,
    };
  })()`);

/**
 * 可见集的两种世界落点(记忆生效 / 只看径向布局),按 `nodes` 遍历序给数组,外加两套候选相机。
 *
 * 为什么要按序给整张表:**画出来的点位与这张表一一对应**(drawPlan 按同一顺序遍历 nodes、
 * 无裁剪时一个不漏),所以主脚本能反推"把世界坐标映到画布上的那个相似变换" ——
 * 不必猜视图相机到底适配的是哪一份点集(实测退出再进图时它适配的是**径向布局**,
 * 因为位置记忆是异步读回来的,`useAutoFit` 只做一次),也就比"猜相机再比坐标"稳得多。
 * `camMem`/`camRaw` 是两种适配结果,只用于报告"它到底用哪一套"。
 */
export const worldPairs = (cdp, id) =>
  cdp.eval(`(async () => {
    const FILTERS = null;
    const S = await ${SCENE};
    if (S === null) return null;
    ${round}
    const pairs = S.view.nodes.map((n) => {
      const p = S.points.get(n.id);
      const q = S.layout.get(n.id);
      return p === undefined || q === undefined ? null : { id: n.id, mem: [r2(p.x), r2(p.y)], raw: [r2(q.x), r2(q.y)] };
    });
    if (pairs.some((x) => x === null)) return null;
    const camOf = (list) => {
      const c = S.camera.fitToView(list, S.w, S.h);
      const r3 = (v) => Math.round(v * 1000) / 1000;
      return { k: r3(c.k), tx: r3(c.tx), ty: r3(c.ty) };
    };
    return {
      pairs, hasKey: Object.prototype.hasOwnProperty.call(S.saved, String(${id})),
      savedKeys: Object.keys(S.saved).length, visible: S.view.nodes.length,
      camMem: camOf(pairs.map((x) => ({ x: x.mem[0], y: x.mem[1] }))),
      camRaw: camOf(pairs.map((x) => ({ x: x.raw[0], y: x.raw[1] }))),
    };
  })()`);
