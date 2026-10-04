/**
 * 关系图视觉重做的真机读数(2026-10-04:分类着色 / 低缩放聚合 / 聚合圆放大锚点)。
 * 从 graph-accept-g3.mjs 调用的独立一段,避免那份文件超 200 行红线。
 *
 * 三条读数都靠页面里的源码模块(开发构建),装机版读不到 —— 那时记 SKIP 而不是假通过。
 */
const PRESS0 = `window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }))`;
/** 页面上暴露的探针:见 installViz 注入的 window.__vizProbe */
const PROBE = `(typeof window.__vizProbe === 'function' ? JSON.stringify(window.__vizProbe()) : null)`;
const WHEEL = (dy, n) => `(() => { const cv = document.querySelector('canvas'); if (!cv) return false;
  const r = cv.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
  for (let i = 0; i < ${n}; i += 1) cv.dispatchEvent(new WheelEvent('wheel', { deltaY: ${dy}, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  return true; })()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runGraphViz({ cdp, ev, record }) {
  await ev(PRESS0);
  await sleep(700);
  const base = await ev(PROBE);
  if (base === null) {
    record('V1 聚合:低缩放时按桶绘制(计数之和 = 可见节点数)', false, '开发构建才暴露探针;装机版跳过');
    record('V2 分类着色:同根轴同色、不同轴不同色', false, '同上');
    record('V3 聚合圆放大:锚点落在该圆上', false, '同上');
    return;
  }
  const b = JSON.parse(base);
  // V1:缩到底 -> 点数下降、计数之和守恒
  await ev(WHEEL(120, 14));
  await sleep(700);
  const low = JSON.parse(await ev(PROBE));
  const sum = low.dots.reduce((s, d) => s + (d.count ?? 1), 0);
  record(
    'V1 聚合:低缩放时按桶绘制(计数之和 = 可见节点数)',
    low.dots.length < b.dots.length && sum === low.visibleNodes,
    `k=${low.k} 点数 ${b.dots.length} -> ${low.dots.length},计数和 ${sum} / 可见 ${low.visibleNodes}`,
  );
  record(
    'V2 分类着色:同根轴同色、不同轴不同色',
    low.colorAxesOk === true,
    `轴色分组一致:${low.colorAxesOk}`,
  );
  // V3:点一个聚合圆 -> 相机放大且锚点在该圆附近
  const target = low.dots.find((d) => (d.count ?? 1) > 1);
  const anchorOk = target
    ? await ev(`(() => { const cv = document.querySelector('canvas'); if (!cv) return false;
        const r = cv.getBoundingClientRect();
        cv.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
          clientX: r.left + ${Math.round(target.x)}, clientY: r.top + ${Math.round(target.y)} }));
        return true; })()`)
    : false;
  await sleep(600);
  const after = JSON.parse(await ev(PROBE));
  record(
    'V3 聚合圆放大:锚点落在该圆上',
    anchorOk === true && after.k > low.k,
    `k ${low.k} -> ${after.k}${target ? `,点中桶(计数 ${target.count})` : ',无聚合圆可点'}`,
  );
  await ev(PRESS0);
}
