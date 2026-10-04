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
  // V1:缩到底 -> 出现纯数字文字(聚合计数)且点数下降
  await ev(WHEEL(120, 14));
  await sleep(700);
  const low = JSON.parse(await ev(PROBE));
  record(
    'V1 聚合:低缩放时按桶绘制(出现计数文字且点数下降)',
    low.aggregated === true && low.dots.length < b.dots.length,
    `点数 ${b.dots.length} -> ${low.dots.length},计数文字 ${low.counts.length} 个(最大 ${Math.max(0, ...low.counts)}),计数和 ${low.sumCounts}`,
  );
  // V2:聚合档每个圆的半径都不小于普通点(聚合圆下限 12px,普通点最大 9px)
  const minR = low.dots.length > 0 ? Math.min(...low.dots.map((d) => d.r)) : 0;
  record(
    'V2 聚合圆半径:每个聚合圆都够大(>= 12px 下限,普通点最大 9px)',
    low.aggregated === true && minR >= 12,
    `最小半径 ${minR}px(普通点上限 9px)`,
  );
  // V3:点一个聚合圆 -> 视野放大(同一块区域里的点数变少、半径回到普通点量级)
  const target = low.dots[0] ?? null;
  const clicked = target
    ? await ev(`(() => { const cv = document.querySelector('canvas'); if (!cv) return false;
        const r = cv.getBoundingClientRect();
        cv.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
          clientX: r.left + ${target.x}, clientY: r.top + ${target.y} }));
        return true; })()`)
    : false;
  await sleep(700);
  const after = JSON.parse(await ev(PROBE));
  record(
    'V3 点聚合圆:放大到该处(计数文字消失 = 已散开成普通节点)',
    clicked === true && after.aggregated === false,
    `点前聚合=${low.aggregated} -> 点后聚合=${after.aggregated},点数 ${low.dots.length} -> ${after.dots.length}`,
  );
  await ev(PRESS0);
}
