// 滚动优化验收(主题一:几何与外观)
//   A 节 容器静态画像(谁在滚、滚动条占多少宽、scrollbar-gutter 生效否)
//   R2 节 滚动条外观与对比度:亮/暗两态 + 悬停,逐像素取色算 WCAG 对比度
//   R3 节 溢出前后同一容器的 clientWidth 与卡片右边缘(防“列表由短变长时横跳”)
//   R1 节附带 两种主题 x 三种缩放下的容器读数(整页滚动与裁切的证据在交互脚本里)
// 输入全部走 CDP 合成(滚轮/截图),不用 OS 鼠标;色态只切根节点 .dark,不写库。
// 用法:node scripts/dev-scroll-geometry.mjs [exe路径] [标签]   默认 E:/1-LifeLog/LifeLog.exe after
// 输出:.superpowers/sdd/2026-09-21-scroll/readings/geometry-<标签>.json(gitignored)
// 前置:单实例应用 —— 脚本会先 taskkill 再以 9222 调试端口拉起,主窗由 ensureMain 经托盘创建。
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { ensureMain, sleep } from './cdp-lib.mjs';

const EXE = process.argv[2] ?? 'E:/1-LifeLog/LifeLog.exe';
const TAG = process.argv[3] ?? 'after';
const OUT = `.superpowers/sdd/2026-09-21-scroll/readings/geometry-${TAG}.json`;
const R = { 标签: TAG, exe: EXE };
const STREAM = '[data-probe="stream"]';
const TAGLIST = '[data-testid="tag-list"]';
const SEARCH = 'input[aria-label="搜索笔记与标签"]';

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

// ---------- PNG 取色与 WCAG 对比度(零依赖:zlib 解 IDAT) ----------
function decodePng(buf) {
  let off = 8, ihdr = null; const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off), t = buf.toString('ascii', off + 4, off + 8);
    const d = buf.subarray(off + 8, off + 8 + len);
    if (t === 'IHDR') ihdr = { w: d.readUInt32BE(0), h: d.readUInt32BE(4), c: d[9] };
    else if (t === 'IDAT') idat.push(d); else if (t === 'IEND') break;
    off += 12 + len;
  }
  const ch = ihdr.c === 6 ? 4 : 3, stride = ihdr.w * ch;
  const raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(stride * ihdr.h);
  let p = 0, prev = Buffer.alloc(stride);
  for (let y = 0; y < ihdr.h; y++) {
    const f = raw[p++], cur = Buffer.from(raw.subarray(p, p + stride)); p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const add = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      cur[i] = (cur[i] + add) & 255;
    }
    cur.copy(out, y * stride); prev = cur;
  }
  return { w: ihdr.w, h: ihdr.h, at: (x, y) => Array.from(out.subarray(y * stride + x * ch, y * stride + x * ch + ch)) };
}
const lum = ([r, g, b]) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100; };
const hex = (c) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');

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

const shot = async (clip) => decodePng(Buffer.from((await cdp.send('Page.captureScreenshot',
  { format: 'png', clip: { ...clip, scale: 1 } })).data, 'base64'));

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
const box = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null;
  const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const theme = async (dark) => { await ev(`document.documentElement.classList.toggle('dark', ${dark})`); await sleep(300); };
const zoom = async (z) => { if (z === 1) await cdp.send('Emulation.clearDeviceMetricsOverride');
  else await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: Math.round(1085 / z), height: Math.round(720 / z), deviceScaleFactor: 1.25 * z, mobile: false });
  await sleep(400); };

// ---------- A. 容器画像 ----------
R.A容器画像 = { 流: await ev(`window.__g.info('${STREAM}')`), 标签区: await ev(`window.__g.info('${TAGLIST}')`),
  搜索框: await ev(`window.__g.info('${SEARCH}')`), 条目数: await ev('window.__g.count()') };

// ---------- R2. 滚动条外观(亮/暗 x 顶部/中段/悬停) ----------
const boxNow = await box(STREAM);
const mid = { x: Math.round(boxNow.x + boxNow.w / 2), y: Math.round(boxNow.y + boxNow.h / 2) };
R.R2外观 = {};
for (const dark of [false, true]) {
  const k = dark ? 'dark' : 'light';
  await theme(dark);
  R.R2外观[k] = { 顶部: await column(STREAM), 顶部_标签区: await column(TAGLIST) };
  await wheel(mid.x, mid.y, 2000);
  await sleep(500);
  R.R2外观[k].中段 = await column(STREAM);
  const i = await ev(`window.__g.info('${STREAM}')`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(i.x + i.w - 5), y: Math.round(i.y + i.h / 2), button: 'none', pointerType: 'mouse' });
  await sleep(400);
  R.R2外观[k].悬停中段 = await column(STREAM);
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
await ev(`window.__g.setValue('${SEARCH}', 'zzz-不存在的关键词-zzz')`);
await sleep(1600);
R.R3滚动条槽.不溢出态 = await snap();
await ev(`window.__g.setValue('${SEARCH}', '')`);
await sleep(1600);
R.R3滚动条槽.恢复后 = await snap();

mkdirSync('.superpowers/sdd/2026-09-21-scroll/readings', { recursive: true });
writeFileSync(OUT, JSON.stringify(R, null, 2));
console.log('\n===== geometry =====');
console.log(JSON.stringify(R, null, 2));
console.log('\n写入', OUT);
close();
