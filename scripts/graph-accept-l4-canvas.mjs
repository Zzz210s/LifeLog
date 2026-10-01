// 关系图 L4 真机读数 8 的**画布侧探针**:按 clearRect 切帧,记下画布上真实发生过的绘制 ——
// ① 线段(两端坐标 + 描边时的线宽与颜色)② 弧(标签点 / 笔记小圆 / 选中环)③ 文字。
//
// 为什么要记线段:link 边在 DOM 上没有任何对应物,画布上那根 accent 线是它唯一的可观测面。
// 全部走 CanvasRenderingContext2D 原型的包装,不引视图源码 —— 读数与实现不是同一份算式。
// 只做与页面的往返,判定留在 dev-links-accept-l4.mjs。
/** 笔记小圆半径(与 graph-notes 的 NOTE_R 同值)。注意**不能**按半径认笔记小圆:
 *  真实库里 `radiusOf(4) = 2.5 + sqrt(4)/4 = 3.0` 的标签点与它同半径(实测多出 11 个假点)。
 *  可靠的判据是**怎么画的**:标签点是实心 `fill`,笔记小圆是空心 `stroke`(线宽 1);
 *  选中环也是 stroke,但线宽 2。*/
export const NOTE_R = 3;
/** 选中环的线宽(与 GraphCanvas 同值):它是**唯一** accent 色的粗圆,拿它校正 accent 的真值 */
const RING_WIDTH = 2;

export const installL4 = (cdp) =>
  cdp.eval(`(() => {
    if (window.__l4V === 2) return true;
    const fresh = () => ({ segs: [], arcs: [], rings: [], texts: [] });
    let cur = fresh();
    const st = { pushed: 0, get: () => cur };
    // 只记**关系图那块画布**:原型包装是全局的,侧栏/信息流里的其他画布也会路过这里
    // (实测不筛会多出 11 个半径 3 的弧,读数直接对不上)
    const mine = (ctx) => ctx.canvas !== null && ctx.canvas !== undefined && ctx.canvas.closest('[data-testid="graph-view"]') !== null;
    // path / arc 按上下文记(同页可能有多个画布,互不串味)
    const pathOf = new WeakMap();
    const arcOf = new WeakMap();
    const P = CanvasRenderingContext2D.prototype;
    const real = {};
    for (const m of ['clearRect', 'beginPath', 'moveTo', 'lineTo', 'arc', 'stroke', 'fillText']) real[m] = P[m];
    P.clearRect = function (...a) {
      if (mine(this)) {
        if (cur.segs.length + cur.arcs.length + cur.texts.length > 0) st.pushed += 1;
        cur = fresh();
      }
      return real.clearRect.apply(this, a);
    };
    P.beginPath = function (...a) { pathOf.delete(this); return real.beginPath.apply(this, a); };
    P.moveTo = function (x, y, ...rest) { pathOf.set(this, { x1: x, y1: y, x2: null, y2: null }); return real.moveTo.call(this, x, y, ...rest); };
    P.lineTo = function (x, y, ...rest) {
      const p = pathOf.get(this);
      if (p) { p.x2 = x; p.y2 = y; }
      return real.lineTo.call(this, x, y, ...rest);
    };
    P.arc = function (x, y, r, ...rest) {
      arcOf.set(this, { x, y, r });
      if (mine(this)) cur.arcs.push({ x, y, r });
      return real.arc.call(this, x, y, r, ...rest);
    };
    // 一次 stroke 要么收一条线段(有 moveTo/lineTo),要么收一个空心圆/环(只有 arc)
    P.stroke = function (...a) {
      if (mine(this)) {
        const style = { width: this.lineWidth, color: this.strokeStyle, alpha: this.globalAlpha };
        const p = pathOf.get(this);
        const arc = arcOf.get(this);
        if (p && p.x2 !== null) cur.segs.push({ ...p, ...style });
        else if (arc) cur.rings.push({ ...arc, ...style });
      }
      pathOf.delete(this);
      arcOf.delete(this);
      return real.stroke.apply(this, a);
    };
    P.fillText = function (t, x, y) {
      if (mine(this)) cur.texts.push({ t: String(t), x, y });
      return real.fillText.call(this, t, x, y);
    };
    window.__l4 = st;
    window.__l4V = 2;
    return true;
  })()`);

/** 当前帧(最近一次完整绘制)的读数 */
export const readL4 = (cdp) =>
  cdp.eval(`(() => {
    const st = window.__l4;
    if (!st) return null;
    const f = st.get();
    const r2 = (v) => Math.round(v * 100) / 100;
    const acc = f.rings.filter((x) => Math.abs(x.width - ${RING_WIDTH}) < 1e-6);
    return {
      pushed: st.pushed,
      // 笔记小圆 = 空心小圆(线宽 1);标签点是实心 fill,不会进这里
      dots: f.rings.filter((x) => Math.abs(x.width - 1) < 1e-6).map((x) => ({ x: r2(x.x), y: r2(x.y), r: x.r })),
      // accent 的真值从**选中环**上取(视图与读数各自读同一个令牌,但这里不解释令牌)
      accent: acc.length > 0 ? acc[0].color : null,
      segs: f.segs.map((s) => ({ x1: r2(s.x1), y1: r2(s.y1), x2: r2(s.x2), y2: r2(s.y2), width: s.width, color: s.color })),
      texts: f.texts.map((t) => t.t),
    };
  })()`);

/** 等一帧满足条件(展开取数是异步的:小圆与 link 段都可能晚到) */
export async function waitL4(cdp, ok, tries = 24, gap = 300) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    last = await readL4(cdp);
    if (last !== null && ok(last)) return last;
    await new Promise((r) => setTimeout(r, gap));
  }
  return last;
}

/** 一帧里的链接段:accent 色 + 线宽 1.5(共现/父子边用另两个令牌,选中环宽 2) */
export const linkSegs = (frame) =>
  frame.segs.filter((s) => s.color === frame.accent && Math.abs(s.width - 1.5) < 1e-6);

/** 两条段是否落同一对点上(link 是双向两条,几何完全重合) */
export const samePair = (a, b, dots) =>
  dots.length === 2 &&
  [[a.x1, a.y1], [a.x2, a.y2], [b.x1, b.y1], [b.x2, b.y2]].every(([x, y]) =>
    dots.some((d) => Math.abs(d.x - x) < 0.51 && Math.abs(d.y - y) < 0.51),
  );
