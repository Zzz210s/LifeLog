// 关系图 G1 真机读数(scripts/dev-graph-accept.mjs)的页面侧探针:
// 只做「装计数器 / 读画布 / 发合成事件 / 量模块耗时」,不做断言(判定留在主脚本)。
// 全部走 CDP Runtime.evaluate:不碰物理鼠标,也不碰库。
import { sleep } from './cdp-lib.mjs';

/**
 * 装「绘制调用计数器」:包住 CanvasRenderingContext2D 的四个绘制方法。
 * 两处用途:① 首帧判据(第一条边/点被画出来的时刻)、④ 静止判据(3 秒内 0 次调用)。
 * 不用 rAF 回调数:探针自己的 rAF 会被算进去,而且新窗口的 rAF 会被节流
 * (实测第一帧要 226ms 才轮询到,而页面内盖戳只有 7ms),"首帧耗时"会变成轮询延迟。
 * 也不用 getImageData 轮询:读画布像素会强制 GPU 同步,反过来拖慢被测的那一帧。
 * 版本号写进 window.__graphPaintV:同一页面反复跑脚本时,旧版包装器不会再叠一层。
 */
export const installPaintCounter = (cdp) =>
  cdp.eval(`(() => {
    if (window.__graphPaintV === 2) return true;
    const counts = { clearRect: 0, fill: 0, stroke: 0, fillText: 0 };
    for (const m of Object.keys(counts)) {
      const orig = CanvasRenderingContext2D.prototype[m];
      CanvasRenderingContext2D.prototype[m] = function (...args) {
        counts[m]++;
        // 首个**有内容**的绘制时刻(第一条边或第一个点)在绘制调用内部盖戳:
        // 进图时先画一张空画布(尺寸还没量到,plan 为空),那不算"出图"。
        if (m !== 'clearRect' && m !== 'fillText' && window.__graphT0 && !window.__graphFirstDraw) {
          window.__graphFirstDraw = performance.now();
        }
        return orig.apply(this, args);
      };
    }
    window.__graphPaint = counts;
    window.__graphPaintV = 2;
    return true;
  })()`);

/** 计数清零 + 清掉首帧时刻戳(每次要单独计时/判静止之前调一次) */
export const resetPaint = (cdp) =>
  cdp.eval(`(() => {
    const c = window.__graphPaint;
    for (const k of Object.keys(c)) c[k] = 0;
    window.__graphFirstDraw = 0;
    return true;
  })()`);

/** 当前绘制调用计数快照 */
export const paintCalls = (cdp) => cdp.eval('({ ...window.__graphPaint })');

/**
 * 等首帧:两个时刻都在页面内盖戳(挂载靠 MutationObserver、首次绘制靠计数器包装),
 * 这里只用定时器轮询把结果取回来 —— 轮询延迟只影响读数何时回到 Node,不影响读数本身。
 * paintMs = -1 表示 600 次轮询内没画过(关系图没打开或整图空白)。
 */
export const waitFirstDraw = (cdp) =>
  cdp.eval(`(async () => {
    const t0 = window.__graphT0 ?? performance.now();
    for (let i = 0; i < 600; i++) {
      if (window.__graphFirstDraw) {
        return {
          mountMs: window.__graphMount ? Math.round(window.__graphMount - t0) : -1,
          paintMs: Math.round(window.__graphFirstDraw - t0),
          observedMs: Math.round(performance.now() - t0),
        };
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    return { mountMs: -1, paintMs: -1, observedMs: Math.round(performance.now() - t0) };
  })()`);

/**
 * 画布内容签名:着墨像素数 + 16 个列桶的着墨分布 + 采样指纹 + 累计绘制调用数 + 着墨质心。
 * 为什么要这么多:连续两次 getImageData 之间**第一次读回**会触发 Chromium 重栅格化
 * (实测 3000 像素的 AA 级差异、着墨数与列桶都不变),只比指纹会把它当成一场重绘。
 * 另外:进视图后的**首次**栅格与之后的重绘会有亚像素级全局差异(实测着墨差 4552/421、
 * 127235 个像素不同,而相机/计划逐项相同),所以像素签名只当"变没变"用;要断言
 * "平移了多少"必须看质心 cx/cy —— 亚像素偏移动不了质心,真实的相机位移会拽着它走。
 */
export const drawSignature = (cdp) =>
  cdp.eval(`(() => {
    const c = document.querySelector('[data-testid="graph-view"] canvas');
    if (!c || c.width === 0) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let painted = 0, sx = 0, sy = 0;
    const buckets = new Array(16).fill(0);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] !== 0) {
        painted++;
        const px = (i >> 2) % c.width, py = ((i >> 2) / c.width) | 0;
        buckets[((px * 16) / c.width) | 0]++;
        sx += px; sy += py;
      }
    }
    let h = 2166136261;
    for (let i = 0; i < d.length; i += 41) { h ^= d[i]; h = Math.imul(h, 16777619); }
    const p = window.__graphPaint;
    const n = painted || 1;
    return { w: c.width, h: c.height, painted, buckets, fp: (h >>> 0).toString(16), draws: p.clearRect + p.fill + p.stroke,
      cx: Math.round(sx / n), cy: Math.round(sy / n) };
  })()`);

/** 打开关系图:先清空输入框(值没变时 React 不触发 onChange,上一次跑完会残留 `>关系图`)再打 `>关系图` -> Enter */
export async function armGraph(ui) {
  await ui.setBox('');
  await sleep(250);
  await ui.setBox('>关系图');
  await sleep(350);
  const rows = await ui.rows();
  await ui.focusBox();
  // 挂载时刻用 MutationObserver 盖戳(比 rAF 轮询精确);t0 紧贴在 Enter 之前
  await ui.ev(`(() => {
    window.__graphMount = 0;
    window.__graphMO?.disconnect();
    const mo = new MutationObserver(() => {
      if (!window.__graphMount && document.querySelector('[data-testid="graph-view"]')) window.__graphMount = performance.now();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    window.__graphMO = mo;
    window.__graphT0 = performance.now();
    return true;
  })()`);
  await ui.enter();
  return rows;
}

/** 退出关系图(Escape 走 window 监听,与键盘焦点无关) */
export async function closeGraph(ui) {
  await ui.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await sleep(400);
  return ui.ev(`!document.querySelector('[data-testid="graph-view"] canvas')`);
}

/** 连发 200 次滚轮缩放,量帧间隔中位/95 分位/最大 */
export const wheelFrames = (cdp, n = 200) =>
  cdp.eval(`(async () => {
    const el = document.querySelector('[data-testid="graph-view"]');
    const gaps = [];
    let last = performance.now();
    for (let i = 0; i < ${n}; i++) {
      el.dispatchEvent(new WheelEvent('wheel', {
        deltaY: i % 2 === 0 ? -120 : 120, clientX: 500, clientY: 350, bubbles: true, cancelable: true,
      }));
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      gaps.push(now - last);
      last = now;
    }
    gaps.sort((a, b) => a - b);
    const r1 = (v) => Math.round(v * 10) / 10;
    return { median: r1(gaps[gaps.length >> 1]), p95: r1(gaps[Math.floor(gaps.length * 0.95)]), max: r1(gaps[gaps.length - 1]) };
  })()`);

/** 拖空白平移:合成 pointerdown/move/up(React 的 onPointerX 挂在容器上) */
export const panDrag = (cdp) =>
  cdp.eval(`(() => {
    const el = document.querySelector('[data-testid="graph-view"]');
    const mk = (type, x, y) => new PointerEvent(type, {
      clientX: x, clientY: y, bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true,
    });
    el.dispatchEvent(mk('pointerdown', 500, 350));
    for (let i = 1; i <= 6; i++) el.dispatchEvent(mk('pointermove', 500 + 10 * i, 350 + 6 * i));
    el.dispatchEvent(mk('pointerup', 560, 386));
    return true;
  })()`);

/**
 * 布局耗时:开发构建下直接 import 源码模块对纯函数计时(生产构建没有源码路径 -> null)。
 * 计时的节点集必须与视图真正布局的那一份一致:走同一份 visibleGraph + collapseRootsOf,
 * 模板也走视图同一条读法(设置 `time_tag_template` 原文 -> normalizeTemplate -> 派生根名)。
 * 折叠某个根会连它的全部后代一起隐藏(本机库 768 个标签里 378 个以时间根开头),
 * 只剔掉根自身等于把 391 个点当 767 个点计时,那只是探针自己的工作量。
 * 返回的 roots 是本次真正折叠的根名,供读数文案照着念(不再写死「时间」)。
 */
export const layoutMs = (cdp, runs = 20) =>
  cdp.eval(`(async () => {
    const mods = await Promise.all([
      import('/src/main-window/graph/radial.ts'),
      import('/src/main-window/graph/graph-view-model.ts'),
      import('/src/main-window/settings/time-tag-settings.ts'),
    ]).catch(() => null);
    if (mods === null) return null;
    const [radial, vm, tt] = mods;
    const raw = await window.__TAURI_INTERNALS__.invoke('graph_data');
    const tpl = tt.normalizeTemplate(await window.__TAURI_INTERNALS__.invoke('get_setting', { key: 'time_tag_template' }));
    const roots = vm.collapseRootsOf(tpl);
    const { nodes } = vm.visibleGraph(raw, { collapsedRoots: roots });
    if (nodes.length === 0) return null;
    const times = [];
    for (let i = 0; i < ${runs}; i++) {
      const t0 = performance.now();
      radial.radialLayout(nodes, { layerGap: 90 });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return { ms: Math.round(times[${Math.floor(runs / 2)}] * 1000) / 1000, nodes: nodes.length, raw: raw.nodes.length, runs: ${runs}, roots };
  })()`);
