// 滚动优化验收(主题一:容器几何与滚动条外观)
//   A 节 容器静态画像(谁在滚、滚动条占多少宽、scrollbar-gutter 生效否)
//   R2 节 滚动条外观与对比度:亮/暗两态 + 悬停(合成指针移到滑块上),逐像素取色算 WCAG 对比度
//   R3 节 溢出态 vs “短但非空”态的 clientWidth 与首条卡片右边缘(防“列表由短变长时横跳”)
//   R2 附带 三种缩放下的容器读数(整页滚动/裁切/输入栏几何在交互与行为脚本里)
// 输入全部走 CDP 合成(滚轮/截图/指针),不用 OS 鼠标;色态只切根节点 .dark,不写库。
// 用法:node scripts/dev-scroll-geometry.mjs [exe路径] [标签]
//   参数:exe路径 默认 E:/1-LifeLog/LifeLog.exe;标签(产物后缀)默认 after
// 输出:.superpowers/sdd/2026-09-21-scroll/readings/geometry-<标签>.json(gitignored)
// 前置:单实例应用 —— 脚本会先 taskkill 再以 9222 调试端口拉起,主窗由 ensureMain 经托盘创建。
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ensureMain, sleep } from './cdp-lib.mjs';
import { decodePng, contrast, hex } from './dev-scroll-png.mjs';

const EXE = process.argv[2] ?? 'E:/1-LifeLog/LifeLog.exe';
const TAG = process.argv[3] ?? 'after';
const OUT = `.superpowers/sdd/2026-09-21-scroll/readings/geometry-${TAG}.json`;
const R = { 标签: TAG, exe: EXE };
const STREAM = '[data-probe="stream"]';
const TAGLIST = '[data-testid="tag-list"]';
// 关键词筛选入口 = 统一输入框的 `/` 模式(侧栏搜索框已随统一输入框 1/3 删除,旧的 aria-label 选择器恒不命中)
const BOX = '[data-testid="unified-input"]';

// ---------- 启动(本机 bash 吞掉 VAR=x 前缀,故由 Node spawn 带 env) ----------
spawnSync('taskkill', ['/F', '/IM', 'LifeLog.exe'], { encoding: 'utf8' });
await sleep(1200);
spawn(EXE, [], { detached: true, stdio: 'ignore',
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9222' } }).unref();
let up = false;
for (let i = 0; i < 30 && !up; i++) {
  await sleep(500);
  up = await fetch('http://127.0.0.1:9222/json/version').then((r) => r.ok).catch(() => false);
}
if (!up) throw new Error('9222 未就绪(先确认没有别的 LifeLog 实例占着单实例锁)');
const { cdp, close } = await ensureMain();
const ev = (e) => cdp.eval(e);

const PAGE = `(() => {
  const info = (sel) => { const el = document.querySelector(sel); if (!el) return null;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return { cw: el.clientWidth, ch: el.clientHeight, sw: el.scrollWidth, sh: el.scrollHeight,
      barW: el.offsetWidth - el.clientWidth, ox: cs.overflowX, oy: cs.overflowY, gutter: cs.scrollbarGutter,
      sbWidth: cs.scrollbarWidth, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      top: Math.round(el.scrollTop), maxTop: el.scrollHeight - el.clientHeight,
      overflow: el.scrollHeight > el.clientHeight + 1 }; };
  window.__g = {
    info,
    mark: () => { const el = document.querySelector('.md-body'); const c = el && el.closest('div[class*=overflow-y-auto]');
      if (!c) return false; c.setAttribute('data-probe','stream'); return true; },
    setValue: (sel, v) => { const el = document.querySelector(sel); if (!el) return false;
      const p = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(p, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true })); return true; },
    count: () => document.querySelectorAll('li .md-body').length,
    firstLiRight: () => { const li = document.querySelector('li'); return li ? Math.round(li.getBoundingClientRect().right) : null; },
  };
  return true;
})()`;
await ev(PAGE);
for (let i = 0; i < 25; i++) { if (await ev('window.__g.mark()')) break; await sleep(400); }
await sleep(800);

const shot = async (clip) => {
  const p = decodePng(Buffer.from((await cdp.send('Page.captureScreenshot',
    { format: 'png', clip: { ...clip, scale: 1 } })).data, 'base64'));
  return { w: p.width, h: p.height, at: p.at };
};

/** 取容器右侧 20 CSS px 一列:轨道色=众数色,滑块=最长非轨道连续段;两端 10 CSS px 的杂色=箭头残留 */
async function column(sel) {
  const i = await ev(`window.__g.info(${JSON.stringify(sel)})`);
  if (!i) return null;
  const img = await shot({ x: Math.round(i.x + i.w - 20), y: Math.round(i.y), width: 20, height: Math.round(i.h) });
  const d = img.w / 20, mid = Math.round(15 * d), bgX = Math.round(2 * d);
  const hist = new Map();
  for (let y = 0; y < img.h; y++) { const k = img.at(mid, y).slice(0, 3).join(','); hist.set(k, (hist.get(k) ?? 0) + 1); }
  const track = [...hist.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
  const same = (c) => c[0] === track[0] && c[1] === track[1] && c[2] === track[2];
  let best = null, cur = null;
  for (let y = 0; y < img.h; y++) {
    if (!same(img.at(mid, y))) { if (cur) cur.y1 = y; else cur = { y0: y, y1: y }; }
    else { if (cur && (!best || cur.y1 - cur.y0 > best.y1 - best.y0)) best = cur; cur = null; }
  }
  if (cur && (!best || cur.y1 - cur.y0 > best.y1 - best.y0)) best = cur;
  let thumbW = null;
  if (best) { const yMid = Math.round((best.y0 + best.y1) / 2);
    let x0 = mid, x1 = mid;
    while (x0 > 0 && !same(img.at(x0 - 1, yMid))) x0--;
    while (x1 < img.w - 1 && !same(img.at(x1 + 1, yMid))) x1++;
    thumbW = Math.round(((x1 - x0 + 1) / d) * 10) / 10; }
  const band = Math.round(10 * d);
  const endsClear = best && best.y0 > band && best.y1 < img.h - band;
  let arrowTop = null, arrowBottom = null;
  if (endsClear) { arrowTop = 0; arrowBottom = 0;
    for (let y = 0; y < band; y++) if (!same(img.at(mid, y))) arrowTop++;
    for (let y = img.h - band; y < img.h; y++) if (!same(img.at(mid, y))) arrowBottom++; }
  const thumbPx = best ? img.at(mid, Math.round((best.y0 + best.y1) / 2)).slice(0, 3) : null;
  const bgPx = img.at(bgX, Math.round(img.h / 2)).slice(0, 3);
  return { 容器: { cw: i.cw, ch: i.ch, sh: i.sh, barW: i.barW, oy: i.oy, top: i.top },
    理想滑块高: Math.round((i.ch * i.ch / i.sh) * 10) / 10,
    实测滑块高: best ? Math.round(((best.y1 - best.y0 + 1) / d) * 10) / 10 : null, 滑块宽: thumbW,
    轨道色: hex(track), 滑块色: thumbPx ? hex(thumbPx) : null, 相邻背景色: hex(bgPx),
    箭头像素_顶: arrowTop, 箭头像素_底: arrowBottom,
    对比度_滑块对轨道: thumbPx ? contrast(thumbPx, track) : null,
    对比度_滑块对背景: thumbPx ? contrast(thumbPx, bgPx) : null };
}

const wheel = async (x, y, dy) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy, pointerType: 'mouse' });
/** IPC 首页条数(与界面 liCount 同口径对账):R3 的「不溢出态」必须短但非空,命中 0 会静默退化成空列表 */
const IPC首页条数 = async (keyword) => ev(`(async () => (await window.__TAURI_INTERNALS__.invoke('query_notes',
  ${JSON.stringify({ conditions: { keyword, tags: [], excludeTags: [], tagPresence: null, sort: 'newest', expr: null }, offset: 0 })})).length)()`);
const box = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null;
  const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const theme = async (dark) => { await ev(`document.documentElement.classList.toggle('dark', ${dark})`); await sleep(300); };
const zoom = async (z) => { if (z === 1) await cdp.send('Emulation.clearDeviceMetricsOverride');
  else await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: Math.round(1085 / z), height: Math.round(720 / z), deviceScaleFactor: 1.25 * z, mobile: false });
  await sleep(400); };

// ---------- A. 容器画像 ----------
R.A容器画像 = { 流: await ev(`window.__g.info('${STREAM}')`), 标签区: await ev(`window.__g.info('${TAGLIST}')`),
  统一输入框: await ev(`window.__g.info('${BOX}')`), 条目数: await ev('window.__g.count()') };

// ---------- R2. 滚动条外观(亮/暗 x 顶部/中段/悬停) ----------
const boxNow = await box(STREAM);
const mid = { x: Math.round(boxNow.x + boxNow.w / 2), y: Math.round(boxNow.y + boxNow.h / 2) };
/** 把合成指针移到内容中点(非滚动条列),保证接下来读到的是“未悬停”态:不先移开,上一轮悬停
    留下的指针会把下一轮的中段读数直接变成 hover 色(暗态实测如此)。 */
const 移开指针 = async () => {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mid.x, y: mid.y, button: 'none', pointerType: 'mouse' });
  await sleep(200);
};
R.R2外观 = {};
for (const dark of [false, true]) {
  const k = dark ? 'dark' : 'light';
  await theme(dark);
  await 移开指针();
  R.R2外观[k] = { 顶部: await column(STREAM), 顶部_标签区: await column(TAGLIST) };
  await wheel(mid.x, mid.y, 2000);
  await sleep(500);
  await 移开指针();
  R.R2外观[k].中段 = await column(STREAM);
  // 悬停必须让合成指针落在**滑块**上(:hover 只对滑块生效)。滑块竖直位置 = 内容滚动比例;
  // 之前固定打容器竖直中点,中段时那里是轨道 -> 悬停色恒等于常态色(复审 Minor 3)。
  // 对照口径:中段 = 悬停前(指针已移到内容中点),悬停中段 = 指针移到滑块中心之后。
  const i = await ev(`window.__g.info('${STREAM}')`);
  const 指针 = { x: Math.round(i.x + i.w - 5), y: Math.round(i.y + (i.ch * i.top) / i.sh + (i.ch * i.ch) / i.sh / 2) };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 指针.x, y: 指针.y, button: 'none', pointerType: 'mouse' });
  await sleep(400);
  R.R2外观[k].悬停中段 = { 指针, ...(await column(STREAM)) };
  await wheel(mid.x, mid.y, -20000);
  await sleep(400);
}
await theme(false);

// ---------- R2 附带:R1 三种缩放下的滚动条与横向溢出 ----------
R.R2缩放 = {};
for (const z of [1, 2, 0.5]) { await zoom(z);
  const s = await ev(`window.__g.info('${STREAM}')`);
  R.R2缩放[z] = { 流: { cw: s.cw, ch: s.ch, barW: s.barW, oy: s.oy, ox: s.ox }, 滚动条: await column(STREAM) }; }
await zoom(1);

// ---------- R3. 溢出态 vs 不溢出态:clientWidth 与卡片右边缘 ----------
const snap = async () => ({ 流cw: (await ev(`window.__g.info('${STREAM}')`)).cw, 流barW: (await ev(`window.__g.info('${STREAM}')`)).barW,
  首条右边缘: await ev('window.__g.firstLiRight()'), 条数: await ev('window.__g.count()'), gutter: await ev(`getComputedStyle(document.querySelector('${STREAM}')).scrollbarGutter`) });
R.R3滚动条槽 = { 溢出态: await snap() };
// 不溢出态必须是“短但非空”:清空列表时首条卡片不存在(首条右边缘 = null)无法与溢出态对比。
// 筛选入口改走统一输入框的 `/` 模式(侧栏关键词框已删);命中数一并落盘 —— 命中 0 时
// 「不溢出态」会静默退化成空列表(与上一轮把两种状态读成同一状态的失真同类,读数里必须看得出来)。
await ev(`window.__g.setValue(${JSON.stringify(BOX)}, '/好忙啊')`);
await sleep(1600);
R.R3滚动条槽.不溢出态 = { IPC首页条数: await IPC首页条数('好忙啊'), ...(await snap()) };
// 清关键词必须留在 `/` 模式下提交空查询:直接把框清空会回记录模式并取消挂起的防抖,关键词清不掉
await ev(`window.__g.setValue(${JSON.stringify(BOX)}, '/')`);
await sleep(1600);
R.R3滚动条槽.恢复后 = { IPC首页条数: await IPC首页条数(null), ...(await snap()) };
await ev(`window.__g.setValue(${JSON.stringify(BOX)}, '')`); // 收尾:框回记录模式
await sleep(400);

mkdirSync('.superpowers/sdd/2026-09-21-scroll/readings', { recursive: true });
writeFileSync(OUT, JSON.stringify(R, null, 2));
console.log('\n===== geometry =====');
console.log(JSON.stringify(R, null, 2));
console.log('\n写入', OUT);
close();
