// 关系图 G3 真机读数(scripts/graph-accept-g3.mjs)的页面侧探针:
// 装机计数器(每帧绘制与帧时刻)、过滤器面板与工具栏驱动、图内搜索、合成指针事件。
// 只做与页面的往返,判定全部留在 graph-accept-g3*.mjs;不碰物理鼠标。
// 「用视图同一份纯函数重算可见集与靶点」的场景探针在 graph-accept-g3-scene.mjs(两个文件各守 200 行红线)。
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './no-tabs-accept-lib.mjs';

const VIEW = `document.querySelector('[data-testid="graph-view"]')`;
const PANEL = `document.querySelector('[data-testid="graph-filters"]')`;

/**
 * 装机(幂等):每帧绘制计数 + 帧时刻表,按 clearRect 切帧。
 * `cur` 是**最近一次**帧、`last` 是它的前一帧 —— 画布的绘制在同一个 effect 里同步跑完,
 * 而 CDP eval 只能排在主线程的空档,所以读 `cur` 不会撞上画到一半的帧;读 `last` 反而会晚一帧
 * (开机时踩过:改完过滤器读 `last`,读到的还是改之前那一帧)。点坐标也收(弧 -> 填 = 一个点圆),
 * 读数 5/6 靠它比"这个点画在哪"。
 */
/**
 * 视觉重做的页面探针(2026-10-04):从**同一套画布插桩**里读,不额外侵入产品代码。
 * 能读到:每个圆(arc+fill 的 x/y/r)、文字(fillText 的字符串,聚合计数就是纯数字)、
 * 一帧里的填充/描边次数。相机 k 不在画布上暴露,所以"是否聚合"由**有无纯数字文字**判定。
 */
export const installVizProbe = (cdp) =>
  cdp.eval(`(() => {
    if (typeof window.__vizProbe === 'function') return true;
    window.__vizProbe = () => {
      const st = window.__g3;
      if (!st || !st.cur) return null;
      const dots = st.cur.dots.map((d) => ({ x: Math.round(d.x), y: Math.round(d.y), r: Math.round(d.r * 10) / 10 }));
      const nums = st.cur.labels.filter((t) => /^[0-9]+$/.test(String(t))).map(Number);
      return {
        dots,
        counts: nums,
        sumCounts: nums.reduce((a, b) => a + b, 0),
        labels: st.cur.labels.filter((t) => !/^[0-9]+$/.test(String(t))).length,
        fills: st.cur.fills,
        arcs: st.cur.arcs,
        aggregated: nums.length > 0,
      };
    };
    return true;
  })()`);

export const installG3 = (cdp) =>
  cdp.eval(`(() => {
    if (window.__g3V === 1) return true;
    const st = { t: [], cur: null, last: null };
    const P = CanvasRenderingContext2D.prototype;
    const real = { clearRect: P.clearRect, arc: P.arc, fill: P.fill, stroke: P.stroke, fillText: P.fillText };
    let lastArc = null;
    P.clearRect = function (...a) {
      if (st.cur !== null) st.last = st.cur;
      st.t.push(performance.now());
      st.cur = { fills: 0, arcs: 0, strokes: 0, labels: [], dots: [] };
      return real.clearRect.apply(this, a);
    };
    P.arc = function (x, y, r, ...rest) { lastArc = { x, y, r }; if (st.cur !== null) st.cur.arcs += 1; return real.arc.call(this, x, y, r, ...rest); };
    P.fill = function (...a) {
      if (st.cur !== null && lastArc !== null) { st.cur.fills += 1; st.cur.dots.push(lastArc); }
      lastArc = null;
      return real.fill.apply(this, a);
    };
    P.stroke = function (...a) { if (st.cur !== null) st.cur.strokes += 1; lastArc = null; return real.stroke.apply(this, a); };
    P.fillText = function (t, ...a) { if (st.cur !== null) st.cur.labels.push(String(t)); return real.fillText.call(this, t, ...a); };
    window.__g3 = st;
    window.__g3V = 1;
    window.__g3State = st; // 兼容旧名字(视觉探针先写的那个)
    return true;
  })()`);

/** 最近一次已经画完的帧:点/弧/线/文字计数 + 点坐标(边 = strokes − (arcs − fills),见 GraphCanvas 的绘制顺序) */
export const lastFrame = (cdp) => cdp.eval('window.__g3.cur ?? window.__g3.last ?? null')

/** 改名会自动登记旧名(旧完整路径 + 旧叶子名),别名表全量快照(公里只读)给读数 7 做"测后复原" */
export function aliasDump() {
  const db = new DatabaseSync('file:' + DB_PATH, { readOnly: true });
  try {
    return db.prepare('SELECT alias, tag_id FROM tag_aliases ORDER BY alias').all().map((r) => `${r.alias}|${r.tag_id}`);
  } finally {
    db.close();
  }
}

/** 别名表逐项一致(读数 7 收尾用:改名登记的那几条必须真的删干净) */
export const sameAliases = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** 状态条文案(计数 / 加载失败 / 展开笔记进度) */
export const graphStatus = (cdp) => cdp.eval(`document.querySelector('[data-testid="graph-status"]')?.textContent ?? null`);

/** 过滤器面板现状(关着时 open=false、axes 为空) */
export const panelState = (cdp) =>
  cdp.eval(`(() => {
    const root = ${PANEL};
    if (root === null) return { open: false, axes: [], maxDepth: null, minNotes: null, onlyWithNotes: null };
    const axes = [...root.querySelectorAll('input[type="checkbox"][aria-label^="展开轴 "]')]
      .map((b) => ({ root: b.getAttribute('aria-label').slice(4), checked: b.checked }));
    const sel = (label) => {
      const s = [...root.querySelectorAll('select')].find((x) => x.getAttribute('aria-label') === label);
      return s === null ? null : Number(s.value);
    };
    const only = root.querySelector('input[aria-label="只显示有笔记的标签"]');
    return { open: true, axes, maxDepth: sel('深度上限'), minNotes: sel('最少笔记数'), onlyWithNotes: only === null ? null : only.checked };
  })()`);

/** 点一个按钮(按文案;scope 缺省整页,工具栏/面板传选择器) */
export const clickText = (cdp, text, scope = 'body') =>
  cdp.eval(`(() => {
    const host = document.querySelector(${JSON.stringify(scope)});
    const b = host === null ? null : [...host.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
    if (b === null) return false;
    b.click();
    return true;
  })()`);

/** 勾/取消勾一个复选框(按 aria-label 精确匹配;轴与「只显示有笔记的标签」共用)。已在目标态返回 false */
export const setFilterBox = (cdp, label, checked) =>
  cdp.eval(`(() => {
    const root = ${PANEL};
    const b = root === null ? null : [...root.querySelectorAll('input[type="checkbox"]')].find((x) => x.getAttribute('aria-label') === ${JSON.stringify(label)});
    if (b === null || b.checked === ${checked}) return false;
    b.click();
    return true;
  })()`);

/** 改一个下拉(按 aria-label;深度上限 / 最少笔记数):受控 select 走原型 setter + change */
export const setFilterSelect = (cdp, label, value) =>
  cdp.eval(`(() => {
    const root = ${PANEL};
    const s = root === null ? null : [...root.querySelectorAll('select')].find((x) => x.getAttribute('aria-label') === ${JSON.stringify(label)});
    if (s === null) return false;
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(String(value))});
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);

/** 画布上合成一次单击(坐标是 client:容器原点 + 画布局部坐标) */
export const clickAt = (cdp, x, y) =>
  cdp.eval(`(() => {
    const el = ${VIEW};
    if (el === null) return false;
    const at = { clientX: ${x}, clientY: ${y}, bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', at));
    el.dispatchEvent(new PointerEvent('pointerup', at));
    el.dispatchEvent(new MouseEvent('click', at));
    return true;
  })()`);

/** 画布上合成一次拖拽:pointerdown -> 6 次等距 move -> pointerup(坐标全是 client) */
export const pointerDrag = (cdp, x0, y0, dx, dy) =>
  cdp.eval(`(() => {
    const el = ${VIEW};
    if (el === null) return false;
    const mk = (type, x, y) => new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true });
    el.dispatchEvent(mk('pointerdown', ${x0}, ${y0}));
    for (let i = 1; i <= 6; i++) el.dispatchEvent(mk('pointermove', ${x0} + (${dx} * i) / 6, ${y0} + (${dy} * i) / 6));
    el.dispatchEvent(mk('pointerup', ${x0 + dx}, ${y0 + dy}));
    return true;
  })()`);

/** 图内搜索框改值(受控输入:原型 setter + input 事件) */
export const setSearch = (cdp, text) =>
  cdp.eval(`(() => {
    const el = document.querySelector('[data-testid="graph-search-input"]');
    if (el === null) return false;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);

/** 图内搜索现状:输入框值 / 候选行文案 / 是否显示「没有匹配的标签」 */
export const searchState = (cdp) =>
  cdp.eval(`(() => {
    const el = document.querySelector('[data-testid="graph-search-input"]');
    if (el === null) return null;
    return {
      value: el.value,
      items: [...document.querySelectorAll('[data-testid="graph-search-item"]')].map((b) => b.textContent.trim()),
      empty: document.querySelector('[data-testid="graph-search-empty"]') !== null,
    };
  })()`);

const isEmptyPositions = (v) => v === null || v === undefined || v === '{}' || (typeof v === 'string' && v.trim() === '');

/**
 * 位置记忆的**空值等价**:库里可能有三种"没有位置"(键缺失 -> get_setting 回 null;IPC 写回空 -> '';
 * 修剪后写回 -> '{}'),`parsePositions` 对三者都得到空表,视图行为完全一样。
 * 对账要比的是"有没有真的位置",不是字符串形态 —— 所以在只读对账里按空值等价比较。
 */
export const positionsEqual = (a, b) => (isEmptyPositions(a) && isEmptyPositions(b)) || a === b;

/** 只读对账口径:库存快照逐项比较,其中 graph_positions 走空值等价(理由见上) */
export const invSame = (a, b) =>
  a.notes === b.notes &&
  a.theme === b.theme &&
  a.filterCurrent === b.filterCurrent &&
  JSON.stringify(a.ids) === JSON.stringify(b.ids) &&
  JSON.stringify(a.paths) === JSON.stringify(b.paths) &&
  positionsEqual(a.graphPositions, b.graphPositions);
