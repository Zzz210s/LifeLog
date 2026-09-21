// 输入栏几何/行为的读数节模块:由 dev-scroll-behavior.mjs 调用,结果并入 readings/behavior.json。
//   R5 补全列表是否真溢出(不该溢出)+ 滚轮与输入事件交错时几何键是否被改写(4 轮全部落盘)
//   R6 按行数增高/收回(1/3/5/7 行 + 清空回单行):输入框与窗口 CSS 高、是否内部可滚
//   R7 候选列表展开 -> 关闭 -> 隐藏 -> 再显示(zoom 2.0 + 5 行 + 8 候选)的窗口物理高与输入框高
// 输入:mainCdp(主窗连接,用于显隐输入栏)、R(结果对象,就地追加)、opts.restore(默认 true,收尾还原几何键)
// 用法:经 `node scripts/dev-scroll-behavior.mjs [exe]` 调用;前置:9222 调试端口上的实例
import { input as openInput, install, js, sleep } from './dev-scroll-lib.mjs';

const LF = String.fromCharCode(10);
const KEYS = ['input_w', 'input_h', 'input_zoom'];
const TA = 'textarea[aria-label="输入栏内容"]';
const LIST = '[data-testid="tag-suggest"]';
/** 5 行 + 8 条候选的基础逻辑高度(前端 windowHeightFor:159.75 + 200,上取整 360) */
export const MAX_CONTENT_BASE = 360;
const FIVE = ['一', '二', '三', '四', '五'].join(LF);
const SEVEN = ['一', '二', '三', '四', '五', '六', '七'].join(LF);
/** '日期' 前缀在真实库里有 313 个标签,候选必然满 8 条(放大"内容 + 列表"这一最大内容) */
const WITH_LIST = FIVE + LF + '#日期';

const call = (cdp, cmd, args = {}) =>
  js(cdp, `(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);
const setText = (cdp, v) =>
  js(cdp, `window.__probe.setValue(document.querySelector(${JSON.stringify(TA)}), ${JSON.stringify(v)})`);
const escapeList = (cdp) =>
  js(cdp, `(() => { const ta = document.querySelector(${JSON.stringify(TA)});
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return true; })()`);
/** 输入框/窗口/候选列表的读数(CSS 像素;窗口 CSS 高 x dpr = 物理高,可与 inner_size 对照) */
const snap = (cdp) =>
  js(cdp, `(() => {
    const ta = document.querySelector(${JSON.stringify(TA)});
    const r = ta.getBoundingClientRect();
    const list = document.querySelector(${JSON.stringify(LIST)});
    const lr = list ? list.getBoundingClientRect() : null;
    return { 输入框CSS高: Math.round(r.height), 输入框底: Math.round(r.bottom),
      输入框可内滚: ta.scrollHeight > ta.clientHeight + 1,
      窗口CSS高: window.innerHeight, 窗口CSS宽: window.innerWidth, dpr: window.devicePixelRatio,
      候选: list ? { 条数: list.querySelectorAll('li,[role="option"]').length, ch: list.clientHeight,
        h: Math.round(lr.height), 视口下沿: Math.round(lr.bottom),
        完整可见: lr.top >= -1 && lr.bottom <= window.innerHeight + 1 } : null };
  })()`);
const keys = async (cdp) => {
  const o = {};
  for (const k of KEYS) o[k] = await call(cdp, 'get_setting', { key: k });
  return o;
};
const phys = (cdp) => call(cdp, 'plugin:window|inner_size', { label: 'input' });

/** 连上输入栏页面(最多等 10s);连不到返回 null */
async function connectInput(mainCdp) {
  await call(mainCdp, 'show_input_bar');
  await sleep(1500);
  for (let i = 0; i < 20; i++) {
    const conn = await openInput().catch(() => null);
    if (conn) return conn;
    await sleep(500);
  }
  return null;
}

export async function inputSections(R, mainCdp, opts = {}) {
  const restore = opts.restore !== false;
  const conn = await connectInput(mainCdp);
  if (!conn) {
    R.R5 = { 跳过: '输入栏页面未出现(先确认实例以 9222 启动且输入栏可见)' };
    return R;
  }
  const { cdp: icdp, close: iclose } = conn;
  await install(icdp);
  await icdp.eval(`document.querySelector(${JSON.stringify(TA)}).focus()`);
  // 基线:全部几何键(收尾要还原到这条基线;写入一律走应用自身命令,不手改库)
  const baseline = await keys(icdp);
  R.基线几何键 = baseline;

  // ---- R5:补全列表是否真溢出(候选上限 8 = 列表最大行数,不该有内部滚动条) ----
  R.R5_列表溢出 = {};
  for (const 词 of ['#a', '#日期']) {
    await setText(icdp, 词);
    await sleep(900);
    R.R5_列表溢出[`候选_${词}`] = await js(icdp, `(() => {
      const list = document.querySelector(${JSON.stringify(LIST)});
      if (!list) return { 无列表: true };
      const cs = getComputedStyle(list);
      return { 条数: list.querySelectorAll('li,[role="option"]').length, ch: list.clientHeight, sh: list.scrollHeight,
        溢出: list.scrollHeight > list.clientHeight, overflowY: cs.overflowY, barW: list.offsetWidth - list.clientWidth };
    })()`);
  }

  // ---- R6:按行数增高 / 收回(zoom 1.00) ----
  R.R6_按行数 = {};
  for (const [名字, 文本] of [['一行', '一'], ['三行', '一' + LF + '二' + LF + '三'], ['五行', FIVE],
    ['七行_应封顶可内滚', SEVEN], ['清空后', '']]) {
    await setText(icdp, 文本);
    await sleep(900);
    R.R6_按行数[名字] = { ...(await snap(icdp)), 库键: await keys(icdp) };
  }

  // ---- R7:滚轮(缩放 IPC 在途)与输入事件压进同一个任务,几何键不得被派生值改写 ----
  R.R7_缩放交错 = {};
  for (const [i, d] of [-120, -120, 120, 120].entries()) {
    const 前 = await keys(icdp);
    await js(icdp, `(() => { const ta = document.querySelector(${JSON.stringify(TA)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new WheelEvent('wheel', { deltaY: ${d}, bubbles: true, cancelable: true })); return true; })()`);
    await sleep(1200);
    const 后 = await keys(icdp);
    R.R7_缩放交错[`第${i + 1}轮_delta${d}`] = {
      前, 后, 几何键任一变化: KEYS.some((k) => 前[k] !== 后[k]), 读数: await snap(icdp),
    };
  }
  await call(icdp, 'set_input_scale', { zoom: 1 });
  await sleep(1200);

  // ---- R8:候选列表展开 -> 关闭 -> 隐藏 -> 再显示(zoom 2.0 + 5 行 + 8 候选) ----
  R.R8_列表与显隐 = {};
  await setText(icdp, FIVE);
  await sleep(900);
  await call(icdp, 'set_input_scale', { zoom: 2 });
  await sleep(1400);
  R.R8_列表与显隐.五行_zoom2_列表关 = { 读数: await snap(icdp), 窗口物理: await phys(icdp), 库键: await keys(icdp) };
  await setText(icdp, WITH_LIST);
  await sleep(1400);
  R.R8_列表与显隐.列表展开 = { 读数: await snap(icdp), 窗口物理: await phys(icdp), 库键: await keys(icdp) };
  await call(icdp, 'hide_input_bar');
  await sleep(1200);
  R.R8_列表与显隐.隐藏后可见性 = await js(icdp, 'document.visibilityState');
  await call(icdp, 'show_input_bar');
  await sleep(2200);
  R.R8_列表与显隐.再显示 = { 读数: await snap(icdp), 窗口物理: await phys(icdp), 库键: await keys(icdp) };
  // 对照:列表关闭时 隐藏 -> 再显示 不应改变高度(说明差异只来自列表这一项)
  await escapeList(icdp);
  await sleep(1200);
  const 关列表后 = { 读数: await snap(icdp), 窗口物理: await phys(icdp) };
  await call(icdp, 'hide_input_bar');
  await sleep(1000);
  await call(icdp, 'show_input_bar');
  await sleep(2000);
  R.R8_列表与显隐.无列表_隐藏再显示 = { 隐藏前: 关列表后, 再显示: { 读数: await snap(icdp), 窗口物理: await phys(icdp) } };

  // ---- 收尾:还原几何键并逐键核对 ----
  if (restore) {
    await setText(icdp, '');
    await call(icdp, 'set_input_scale', { zoom: 1 });
    await sleep(1600);
    const 还原后 = await keys(icdp);
    R.收尾 = { 还原后, 基线键: baseline, 逐键一致: KEYS.every((k) => 还原后[k] === baseline[k]) };
  }
  iclose(); // 输入栏那条连接不关会让 node 进程挂住
  return R;
}
