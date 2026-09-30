// 关系图 G2 真机读数(scripts/graph-accept-g2.mjs)的页面侧探针:装「帧记录器」/ 读可见图几何 /
// 在容器局部坐标上合成指针事件。只做与页面的往返,判定留在 graph-accept-g2.mjs;不碰物理鼠标,也不碰库。
//
// 坐标口径(与 useGraphInteractions 一致):指针事件吃 client(视口)坐标 = 容器原点 + 画布局部坐标。
// 相机不进 DOM,这里用同一份纯函数重算:进图后唯一的自动适配是 reset() = fitToView(尺寸, 落点),
// 而读数 5 收尾刚按过 `0`(见 dev-graph-accept.mjs),所以此刻相机就是适配值;位置记忆
// (graph_positions)按视图同一条只读叠加口径合进去。
//
// 「帧记录器」按 clearRect 切帧:每帧记下 fill 的点(每个一次,带 globalAlpha)、带弧的 stroke
// (选中环 / 笔记小圆)与 fillText 文案 —— 弱化只改 globalAlpha 不换颜色,真机上就这一个可观测口径。
import { sleep } from './cdp-lib.mjs';

/** 笔记小圆半径(与 graph-notes 的 NOTE_R 同值):读数靠它把笔记小圆从选中环里分出来 */
export const NOTE_R = 3; // 笔记小圆是唯一半径为 3 的 stroke(选中环 = 点半径 + 3,最小 5.5)

const VIEW = `document.querySelector('[data-testid="graph-view"]')`;

export const installG2 = (cdp) =>
  cdp.eval(`(() => {
    if (window.__g2V === 1) return true;
    let cur = { dots: [], rings: [], texts: [] };
    const st = { pushed: 0, get: () => cur };
    const last = new WeakMap();
    const P = CanvasRenderingContext2D.prototype;
    const real = {};
    for (const m of ['clearRect', 'arc', 'fill', 'stroke', 'fillText']) real[m] = P[m];
    P.clearRect = function (...a) {
      if (cur.dots.length + cur.rings.length + cur.texts.length > 0) st.pushed += 1; // 单调帧序号
      cur = { dots: [], rings: [], texts: [] };
      return real.clearRect.apply(this, a);
    };
    P.arc = function (x, y, r, ...rest) { last.set(this, { x, y, r }); return real.arc.call(this, x, y, r, ...rest); };
    P.fill = function (...a) {
      const p = last.get(this); last.delete(this);
      if (p) cur.dots.push({ ...p, alpha: this.globalAlpha });
      return real.fill.apply(this, a);
    };
    P.stroke = function (...a) {
      const p = last.get(this); last.delete(this);
      if (p) cur.rings.push({ ...p, alpha: this.globalAlpha, width: this.lineWidth });
      return real.stroke.apply(this, a);
    };
    P.fillText = function (t, x, y) { cur.texts.push({ t: String(t), x, y }); return real.fillText.call(this, t, x, y); };
    window.__g2 = st;
    window.__g2V = 1;
    return true;
  })()`);

/** 当前帧(最近一次完整绘制):点位 / 弧 / 文案 + 单调的帧序号 */
export const readFrame = (cdp) =>
  cdp.eval(`(() => {
    const st = window.__g2;
    if (!st) return null;
    const f = st.get();
    return { pushed: st.pushed, dots: f.dots, rings: f.rings, texts: f.texts };
  })()`);

/**
 * 可见图几何(开发构建下才有源码模块路径;生产构建返回 null)。
 * 返回项:画布尺寸与原点(容器/画布两处,量它们是否重合)、相机 k、可见节点数、以及三个靶子
 * (悬停 / 笔记最多 / 无可见子级的叶子)的画布局部坐标 —— 靶子选择也在这里做,免得主脚本再引一次源码。
 */
export const graphGeom = (cdp) =>
  cdp.eval(`(async () => {
    const mods = await Promise.all([
      import('/src/main-window/graph/radial.ts'),
      import('/src/main-window/graph/graph-view-model.ts'),
      import('/src/main-window/graph/graph-camera.ts'),
      import('/src/main-window/graph/graph-focus.ts'),
      import('/src/main-window/graph/graph-hit.ts'),
      import('/src/main-window/graph/use-graph-camera.ts'),
      import('/src/main-window/settings/time-tag-settings.ts'),
      import('/src/shared/tag-label-plain.ts'),
    ]).catch(() => null);
    if (mods === null) return null;
    const [radial, vm, camera, focus, hitMod, hcam, tt, label] = mods;
    const T = window.__TAURI_INTERNALS__.invoke;
    const raw = await T('graph_data');
    const tpl = tt.normalizeTemplate(await T('get_setting', { key: 'time_tag_template' }));
    const roots = vm.collapseRootsOf(tpl);
    const { nodes, edges } = vm.visibleGraph(raw, { collapsedRoots: roots });
    if (nodes.length === 0) return null;
    const layout = radial.radialLayout(nodes, { layerGap: 90 });
    const savedRaw = await T('get_setting', { key: 'graph_positions' });
    const points = hcam.overlayPositions(layout, hcam.parseGraphPositions(savedRaw === undefined ? null : savedRaw));
    const view = ${VIEW};
    const cv = view.querySelector('canvas');
    const vrect = view.getBoundingClientRect();
    const crect = cv.getBoundingClientRect();
    const cam = camera.fitToView([...points.values()], crect.width, crect.height);
    const r2 = (v) => Math.round(v * 100) / 100;
    const at = (id) => { const p = points.get(id); if (p === undefined) return null; const s = camera.screenOf(p, cam); return { x: r2(s.x), y: r2(s.y) }; };
    const info = (n) => ({ id: n.id, path: n.path, plain: label.tagLabelPlain(n.path), notes: n.notes, selfCount: n.selfCount, ...at(n.id) });
    // 靶点不取圆心:布局很挤(根层 23 个根挤在半径 31.5 的圆上,实测「时间」与「日记」只差 0.5 CSS px),
    // 圆心会被相邻节点抢走 —— 同一坐标悬停与双击各解到不同节点(G2-4 曾因此摸到邻点)。
    // 所以只收「最近邻 ≥ 8px」的靶,并把落点往背离最近邻一侧偏 1/4 间距:仍在命中圈内,且与邻点的间距拉到 3 倍。
    const sxy = (id) => { const p = points.get(id); return p === undefined ? null : camera.screenOf(p, cam); };
    const aimOf = (n) => {
      const s = sxy(n.id);
      if (s === null) return null;
      let nn = null;
      for (const m of nodes) {
        if (m.id === n.id) continue;
        const t = sxy(m.id);
        if (t === null) continue;
        const d = Math.hypot(t.x - s.x, t.y - s.y);
        if (nn === null || d < nn.d) nn = { d, t };
      }
      if (nn === null || nn.d < 8) return null;
      const step = nn.d / 4;
      const x = s.x + ((s.x - nn.t.x) / nn.d) * step;
      const y = s.y + ((s.y - nn.t.y) / nn.d) * step;
      if (hitMod.hitTest({ nodes, points, cam, x, y }) !== n.id) return null; // 偏完还得落在自己身上
      return { x: r2(x), y: r2(y), gap: r2(nn.d) };
    };
    let hover = null;
    let big = null;
    let leaf = null;
    for (const n of nodes) {
      if (leaf === null && !nodes.some((m) => m.id !== n.id && m.path.startsWith(n.path + '/'))) leaf = n;
      const a = aimOf(n);
      if (a === null) continue;
      const d = focus.neighborsOf(edges, n.id).size;
      if (hover === null || d > hover.d) hover = { n, a, d };
      if (n.notes > 20 && (big === null || n.notes > big.n.notes)) big = { n, a };
    }
    if (hover === null || big === null || leaf === null) return null;
    return {
      k: cam.k, w: crect.width, h: crect.height,
      originX: r2(vrect.left), originY: r2(vrect.top), left: crect.left, top: crect.top,
      offsetX: r2(crect.left - vrect.left), offsetY: r2(crect.top - vrect.top),
      visible: nodes.length, edges: edges.length, roots, tags: raw.nodes.length,
      hover: { ...info(hover.n), aim: hover.a, neighbors: hover.d },
      big: { ...info(big.n), aim: big.a },
      leaf: { ...info(leaf), query: label.tagLabelPlain(leaf.path) },
    };
  })()`);

const opts = (x, y, extra = '') => `{ clientX: ${x}, clientY: ${y}, bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true${extra} }`;

/** 悬停:pointermove 落在容器上(React 的 onPointerMove) */
export const moveTo = (cdp, x, y) =>
  cdp.eval(`(() => { ${VIEW}.dispatchEvent(new PointerEvent('pointermove', ${opts(x, y)})); return true; })()`);

/** 单击:pointerdown + pointerup + click(单击只认 click,前两个是真实序列的一部分) */
export const clickAt = (cdp, x, y) =>
  cdp.eval(`(() => { const el = ${VIEW};
    el.dispatchEvent(new PointerEvent('pointerdown', ${opts(x, y)}));
    el.dispatchEvent(new PointerEvent('pointerup', ${opts(x, y)}));
    el.dispatchEvent(new MouseEvent('click', ${opts(x, y)}));
    return true; })()`);

/** 双击:dblclick 一步到位(合成事件没有浏览器的 click,click,dblclick 序列) */
export const doubleClickAt = (cdp, x, y) =>
  cdp.eval(`(() => { ${VIEW}.dispatchEvent(new MouseEvent('dblclick', ${opts(x, y, ', detail: 2')})); return true; })()`);

/** 右键:contextmenu(button 2) */
export const rightClickAt = (cdp, x, y) =>
  cdp.eval(`(() => { ${VIEW}.dispatchEvent(new MouseEvent('contextmenu', ${opts(x, y)})); return true; })()`);

/** 焦点进图内搜索框(它不在画布命中里,直接 focus) */
export const focusSearch = (cdp) =>
  cdp.eval(`(() => { const el = document.querySelector('[data-testid="graph-search-input"]'); if (!el) return false; el.focus(); return document.activeElement === el; })()`);

/** 受控输入的改值手法:原型 setter + input 事件(与 bindUi.setBox 同一条) */
export const setSearchQuery = (cdp, text) =>
  cdp.eval(`(() => {
    const el = document.querySelector('[data-testid="graph-search-input"]');
    if (!el) return false;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);

/** 原生键事件(走 CDP Input,和 ui.enter 同一条路):目标 = 当前焦点元素;`text` 省略则不插入字符 */
export const keyPress = async (cdp, key, code, vk, text) => {
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  if (text !== undefined) {
    base.text = text;
    base.unmodifiedText = text;
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(250);
};

/** 等某一帧条件成立(取数是异步的,笔记小圆与信息条都可能晚到) */
export async function waitFrame(cdp, ok, tries = 20, gap = 300) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    last = await readFrame(cdp);
    if (last !== null && ok(last)) return last;
    await sleep(gap);
  }
  return last;
}
