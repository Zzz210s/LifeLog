// 关系备注「默认状态」真机证据(装机版):不动任何开关时的可见性 + 默认 fit 的 k 读数。
//
// 与 dev-relations-demo.mjs 的分工:那个脚本**显式打开**开关并造夹具给用户看;
// 这个脚本**反着来** —— 删掉新键(只留真库里那条旧键 `tag_tree_show_carry=false`),
// 证明「用户什么都不碰」时侧栏小字与关系图备注是否出现。
// 页面侧只读:探针复用产品自己的画布插桩(arc/fill/fillText),不往产品代码塞钩子。
// 用法(装机版带调试端口启动):
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9333'; E:\1-LifeLog\LifeLog.exe
//   $env:LIFELOG_CDP_PORT='9333'; node scripts/dev-relations-default.mjs
import { mkdirSync } from 'node:fs';
import { ensureMain, sleep, waitFor } from './cdp-lib.mjs';
import { bindUi } from './no-tabs-accept-lib.mjs';
import { armGraph } from './graph-accept-lib.mjs';
import {
  ipc, requireApp, deleteSetting, relationChipsOf, rowTipOf, installRelationProbe, relationFrame, pressEsc, get,
} from './relations-accept-lib.mjs';
import { ROOT, SOURCE, REMARK, SHOTS, SH, rowSel, canvasBox, probe, shot, installProbe } from './relations-demo-lib.mjs';

// 自包含重算(装机版不能 import /src):与 radial.ts / graph-filters.ts / graph-camera.ts 同算法。
// 只为拿默认 fit 的 k;结果再用画布上真画出来的点做残差校验(见 validate)。
const MEASURE = `(async () => {
  const T = window.__TAURI_INTERNALS__.invoke;
  const raw = await T('graph_data');
  const tpl = String((await T('get_setting', { key: 'time_tag_template' })) ?? '');
  const savedRaw = await T('get_setting', { key: 'graph_positions' });
  let saved = {};
  try { saved = JSON.parse(savedRaw) || {}; } catch { saved = {}; }
  const segs = tpl.split('/').map((s) => s.trim()).filter(Boolean);
  const collapsed = segs.length >= 2 && !segs[0].includes('{') ? [segs[0]] : [];
  const byId = new Map(raw.nodes.map((n) => [n.id, n]));
  const axisOf = (n) => { let c = n, seen = new Set(); while (c && c.parent !== null) { if (seen.has(c.id)) return null; seen.add(c.id); c = byId.get(c.parent); } return c ? c.path : null; };
  const nodes = raw.nodes.filter((n) => { const a = axisOf(n); if (a === null) return false; if (n.parent !== null && collapsed.includes(a)) return false; return n.depth <= 6 && n.notes >= 0; });
  const ids = new Set(nodes.map((n) => n.id));
  const kids = new Map(); const size = new Map();
  for (const n of nodes) { const p = n.parent !== null && ids.has(n.parent) ? n.parent : -1; const l = kids.get(p) ?? []; l.push(n.id); kids.set(p, l); }
  const walk = (id) => { let t = 1; for (const k of kids.get(id) ?? []) t += walk(k); size.set(id, t); return t; };
  for (const n of nodes) if (n.parent === null || !ids.has(n.parent)) walk(n.id);
  const out = new Map();
  const r2 = (v) => Math.round(v * 100) / 100;
  const place = (id, from, to) => { const mid = (from + to) / 2; const d = byId.get(id).depth; const r = d === 1 ? 90 * 0.35 : (d - 1) * 90; out.set(id, { x: Math.cos(mid) * r, y: Math.sin(mid) * r }); const ch = kids.get(id) ?? []; const tot = ch.reduce((s, c) => s + (size.get(c) ?? 1), 0) || 1; let at = from; for (const c of ch) { const sp = ((to - from) * (size.get(c) ?? 1)) / tot; place(c, at, at + sp); at += sp; } };
  const roots = kids.get(-1) ?? []; const tr = roots.reduce((s, c) => s + (size.get(c) ?? 1), 0) || 1; let at = 0;
  for (const rr of roots) { const sp = (Math.PI * 2 * (size.get(rr) ?? 1)) / tr; place(rr, at, at + sp); at += sp; }
  for (const [k, v] of Object.entries(saved)) { if (typeof v?.x === 'number' && typeof v?.y === 'number') out.set(Number(k), { x: v.x, y: v.y }); }
  const pts = [...out.values()];
  const el = document.querySelector('[data-testid="graph-view"]');
  const w = el.clientWidth, h = el.clientHeight;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const spanX = Math.max(Math.max(...xs) - Math.min(...xs), 1), spanY = Math.max(Math.max(...ys) - Math.min(...ys), 1);
  const k = Math.min(w * 0.9 / spanX, h * 0.9 / spanY);
  const clamped = Math.min(Math.max(k, 0.5), 4);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const cam = { k: clamped, tx: w / 2 - cx * clamped, ty: h / 2 - cy * clamped };
  const screen = pts.map((p) => ({ x: r2(p.x * cam.k + cam.tx), y: r2(p.y * cam.k + cam.ty) }));
  const want = WANT_IDS.map((id) => { const p = out.get(id); return p ? { x: r2(p.x * cam.k + cam.tx), y: r2(p.y * cam.k + cam.ty) } : null; });
  return { k: r2(cam.k), tx: r2(cam.tx), ty: r2(cam.ty), w, h, nodes: nodes.length, savedKeys: Object.keys(saved).length, collapsed, screen, want };
})()`;

/** 残差:自算屏幕点与画布上真画出的圆一一最近配对(证明自算与视图同口径) */
function residual(predicted, dots) {
  if (!predicted?.length || !dots?.length) return null;
  let max = 0;
  for (const p of predicted) {
    let best = Infinity;
    for (const d of dots) best = Math.min(best, Math.hypot(d.x - p.x, d.y - p.y));
    max = Math.max(max, best);
  }
  return Math.round(max * 10) / 10;
}

requireApp();
const SRC_PATH = '作者/丸尾常喜';
const DST_PATH = '关系演示/[属性](箭头上的备注文字)';
const EDGE_IDS = [
  get('SELECT id FROM tags WHERE path=?1', SRC_PATH)?.id ?? null,
  get('SELECT id FROM tags WHERE path=?1', DST_PATH)?.id ?? null,
];
console.log(`INFO 演示边标签 id src=${EDGE_IDS[0]} dst=${EDGE_IDS[1]}`);
const conn = await ensureMain();
const cdp = conn.cdp;
const ui = bindUi(cdp);
const call = (cmd, args = {}) => ipc(cdp, cmd, args);
mkdirSync(SHOTS, { recursive: true });
const shots = [];

// 默认状态:删掉新键;真库里的旧键 `tag_tree_show_carry` 原样留着(真值 false),用于判别回读是否还在
deleteSetting('tag_tree_show_relations');
const settingsNow = await call('get_setting', { key: 'tag_tree_show_carry' });
await cdp.send('Page.reload');
await waitFor(() => cdp.eval(`!!document.querySelector('[data-testid="unified-input"]')`).catch(() => false), 60, 400);
await sleep(1600);
console.log(`INFO 默认状态:新键已删,旧键 tag_tree_show_carry=${JSON.stringify(settingsNow)}`);

// --- 侧栏:展开作者,读 作者/丸尾常喜 行的关系小字 ---
await waitFor(() => cdp.eval(`!!document.querySelector('aside ' + ${rowSel(ROOT)})`).catch(() => false), 24, 300);
const srcReady = () => cdp.eval(`!!document.querySelector('aside ' + ${rowSel(SOURCE)})`).catch(() => false);
if (!(await srcReady())) {
  await cdp.eval(`(() => { const r = document.querySelector('aside ' + ${rowSel(ROOT)}); const s = r?.querySelector('svg'); if (s) s.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  await waitFor(srcReady, 20, 250);
}
const box = await cdp.eval(`(() => { const r = document.querySelector('aside ' + ${rowSel(SOURCE)}); if (!r) return null; r.scrollIntoView({ block: 'center' }); const b = r.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })()`);
await sleep(400);
const chips = await relationChipsOf(cdp, SOURCE);
const tip = await rowTipOf(cdp, SOURCE);
shots.push(await shot(cdp, SH('default-2-sidebar')));
if (box) shots.push(await shot(cdp, SH('default-2b-sidebar-closeup'), { x: 0, y: Math.max(0, box.y - 40), width: 460, height: 200 }, 2));
console.log(`INFO 侧栏 作者/丸尾常喜 chips=${JSON.stringify(chips)} 卡片末行=「${String(tip).split('\n').pop()}」`);

// --- 关系图:默认视图(不缩放)读 k 与备注 ---
// 探针必须在**开图之前**装:图静止后不再重绘,装晚了读到的是空帧(首轮实测踩过)。
await installRelationProbe(cdp);
await installProbe(cdp);
await armGraph(ui);
await sleep(4200); // 等首次适配 + 径向落定
const measure = await cdp.eval(MEASURE.replace('WANT_IDS', JSON.stringify(EDGE_IDS)));
const mk0 = await relationFrame(cdp);
const dots = await probe(cdp);
const res = residual(measure?.screen, dots?.dots);
const markDefault = (mk0?.texts ?? []).includes(REMARK);
const cb = await canvasBox(cdp);
if (cb) shots.push(await shot(cdp, SH('default-1-graph')));
const mkPos = (dots?.texts ?? []).find((m) => m.t === REMARK);
if (cb && mkPos) {
  const cl = (dx, dy, w, h, s) => ({ x: cb.left + Math.max(0, mkPos.x + dx), y: cb.top + Math.max(0, mkPos.y + dy), width: w, height: h });
  shots.push(await shot(cdp, SH('default-1b-graph-closeup'), cl(-150, -65, 300, 130), 3));
  // 这条备注所属的关系边:直接拿两个端点在相机下的屏幕位置画裁剪框(不再猜最近的箭头)
  const [pa, pb] = measure?.want ?? [];
  if (pa && pb) {
    const px = [mkPos.x, pa.x, pb.x], py = [mkPos.y, pa.y, pb.y];
    const x0 = Math.min(...px) - 70, y0 = Math.min(...py) - 70, x1 = Math.max(...px) + 70, y1 = Math.max(...py) + 70;
    shots.push(await shot(cdp, SH('default-1d-graph-edge'), { x: cb.left + Math.max(0, x0), y: cb.top + Math.max(0, y0), width: x1 - x0, height: y1 - y0 }, 1.6));
    shots.push(await shot(cdp, SH('default-1e-graph-arrow'), { x: cb.left + Math.max(0, pb.x - 50), y: cb.top + Math.max(0, pb.y - 50), width: 100, height: 100 }, 4));
    const arrow = (mk0?.arrowTips ?? []).map((t) => ({ ...t, d: Math.hypot(t.end[0] - pb.x, t.end[1] - pb.y) })).sort((a, b) => a.d - b.d)[0];
    if (arrow) {
      shots.push(await shot(cdp, SH('default-1f-graph-arrowhead'), { x: cb.left + Math.max(0, arrow.tip[0] - 30), y: cb.top + Math.max(0, arrow.tip[1] - 30), width: 60, height: 60 }, 6));
      console.log(`INFO 演示边箭头 尖=(${arrow.tip[0]},${arrow.tip[1]}) 终点=(${arrow.end[0]},${arrow.end[1]}) 离 dst ${Math.round(arrow.d)}px`);
    }
    console.log(`INFO 演示边屏幕端点 src=(${pa.x},${pa.y}) dst=(${pb.x},${pb.y}) 胶囊=(${mkPos.x},${mkPos.y})`);
  } else {
    shots.push(await shot(cdp, SH('default-1d-graph-edge'), { x: cb.left, y: cb.top, width: cb.w, height: cb.h }, 1.4));
  }
} else if (cb) {
  shots.push(await shot(cdp, SH('default-1d-graph-edge'), { x: cb.left, y: cb.top, width: cb.w, height: cb.h }, 1.4));
}
console.log(`INFO 关系图默认 k=${measure?.k} (tx=${measure?.tx} ty=${measure?.ty} 画布 ${measure?.w}x${measure?.h} 可见点 ${measure?.nodes} 记忆 ${measure?.savedKeys} 折叠 ${JSON.stringify(measure?.collapsed)})`);
console.log(`INFO 自算 vs 画布 残差=${res}px(应 <= 2);默认视图备注文字已画=${markDefault}`);
console.log(`INFO 默认未见关系边的话另查:箭头数=${mk0?.arrowHeads ?? 0} 文字数=${(mk0?.texts ?? []).length}`);
if (cb && !markDefault) shots.push(await shot(cdp, SH('default-1b-graph-canvas'), { x: cb.left, y: cb.top, width: cb.w, height: cb.h }));

// 放大一档(合成滚轮,锚点画布中心):看备注是否在放大后出现
const zoom = (ticks) => cdp.eval(`(async () => { const el = document.querySelector('[data-testid="graph-view"]'); const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; for (let i = 0; i < ${ticks}; i++) { el.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: x, clientY: y, bubbles: true, cancelable: true })); await new Promise((q) => requestAnimationFrame(q)); } return true; })()`);
await zoom(1);
await sleep(600);
const mk1 = await relationFrame(cdp);
console.log(`INFO 放大一档后备注文字已画=${(mk1?.texts ?? []).includes(REMARK)}(默认 k=${measure?.k},×1.15=${measure ? Math.round(measure.k * 1.15 * 100) / 100 : 'n/a'})`);
shots.push(await shot(cdp, SH('default-1c-graph-zoom1')));
await pressEsc(cdp);
await sleep(300);
await deleteSetting('tag_tree_show_relations'); // 收尾:回到真正的默认(删键)
console.log(`\n截图 ${shots.map((f) => f.replace(/\\/g, '/')).join(' , ')}`);
conn.close();
await sleep(200);
