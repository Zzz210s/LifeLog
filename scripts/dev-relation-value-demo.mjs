#!/usr/bin/env node
/**
 * 侧栏关系显示改版(行内只给值 + 悬停值给属性名 + 悬停标签名给档案卡片)的真机拍照脚本。
 *
 * 前置:装机版带调试端口启动(端口用 LIFELOG_CDP_PORT 覆盖,默认 9333):
 *   `$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9333'; E:\1-LifeLog\LifeLog.exe`
 * 真实库只读:只展开树、合成 mouseover、截图,不写设置也不写数据。
 * 用法:`node scripts/dev-relation-value-demo.mjs`
 */
import { mkdirSync } from 'node:fs';
import { ensureMain, sleep, waitFor } from './cdp-lib.mjs';
import { requireApp, relationChipsOf, rowTipOf } from './relations-accept-lib.mjs';
import { shot, rowSel, SHOTS } from './relations-demo-lib.mjs';

const SH = (n) => `${SHOTS}/relation-value-${n}.png`;
const AUTHOR = '作者';
const SOURCE = '作者/冯骥才';
const CARD_MULTI = '作者/丸尾常喜';

requireApp();
const log = (...a) => console.log(...a);
const conn = await ensureMain();
const cdp = conn.cdp;
mkdirSync(SHOTS, { recursive: true });
const waitShell = () => waitFor(() => cdp.eval(`!!document.querySelector('[data-testid="unified-input"]')`).catch(() => false), 60, 400);
await waitShell();

const win = await cdp.send('Browser.getWindowForTarget', { targetId: conn.target.id }).catch(() => null);
if (win?.windowId) {
  await cdp.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: { left: 40, top: 20, width: 1480, height: 980, windowState: 'normal' } }).catch(() => null);
  await sleep(1200);
}

const rowReady = (path) => cdp.eval(`!!document.querySelector('aside ' + ${rowSel(path)})`).catch(() => false);
/** 展开「作者」并滚到目标行(树模式未展开时子行不在 DOM 里),回行几何给截图裁切用 */
async function revealRow(path) {
  await waitFor(() => rowReady(AUTHOR), 24, 300);
  if (!(await rowReady(path))) {
    const clicked = await cdp.eval(`(() => { const r = document.querySelector('aside ' + ${rowSel(AUTHOR)}); const svg = r?.querySelector('svg');
      if (!svg) return false; svg.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
    log(`INFO 展开「${AUTHOR}」= ${clicked}`);
    await waitFor(() => rowReady(path), 20, 250);
  }
  const geo = await waitFor(() => cdp.eval(`(() => { const r = document.querySelector('aside ' + ${rowSel(path)}); if (!r) return false;
    r.scrollIntoView({ block: 'center' });
    const b = r.getBoundingClientRect(); return { y: Math.round(b.y), h: Math.round(b.height) }; })()`), 20, 250);
  await sleep(400);
  return geo;
}

/** 合成 mouseover(冒泡到 document 上的 HoverTip 委托):悬停的必须是带 data-tip 的元素本身 */
const hoverInside = (path, inner) =>
  cdp.eval(`(() => { const r = document.querySelector('aside ' + ${rowSel(path)}); const el = r && ${inner};
    if (!el) return false; const b = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 })); return true; })()`);

/** 气泡读数:整体文本 + 档案卡片的关系行(左列属性名 / 右列值) */
const bubbleFacts = () =>
  cdp.eval(`(() => { const t = document.querySelector('[data-testid="hover-tip"]'); if (!t) return null;
    return { text: t.textContent, labels: Array.from(t.querySelectorAll('[data-tip-row-label]')).map((x) => x.textContent),
      values: Array.from(t.querySelectorAll('[data-tip-row-value]')).map((x) => x.textContent) }; })()`);
const chipTipOf = (path) =>
  cdp.eval(`(() => { const r = document.querySelector('aside ' + ${rowSel(path)});
    return r?.querySelector('[data-tag-relation]')?.getAttribute('data-tip') ?? null; })()`);

const shots = [];
// ① 行内只显示值(无箭头、无属性名)
const geo = await revealRow(SOURCE);
const chips = await relationChipsOf(cdp, SOURCE);
log(`INFO 行内小字=${JSON.stringify(chips)} 值上的提示=${JSON.stringify(await chipTipOf(SOURCE))}`);
shots.push(await shot(cdp, SH('1-row-value'), geo ? { x: 0, y: Math.max(0, geo.y - 60), width: 460, height: 190 } : undefined, 2));

// ② 悬停那个值 → 属性名
await hoverInside(SOURCE, `r.querySelector('[data-tag-relation]')`);
await sleep(400);
log(`INFO 悬停值的气泡=${JSON.stringify(await bubbleFacts())}`);
shots.push(await shot(cdp, SH('2-hover-value'), geo ? { x: 0, y: Math.max(0, geo.y - 8), width: 460, height: 96 } : undefined, 2));

// ②b 同行是「值」而下一行没有关系小字的作者(华国凡):气泡只可能属于它,排除歧义
const geoB = await revealRow('作者/华国凡');
await hoverInside('作者/华国凡', `r.querySelector('[data-tag-relation]')`);
await sleep(400);
log(`INFO 华国凡 值上的提示=${JSON.stringify(await chipTipOf('作者/华国凡'))} 气泡=${JSON.stringify((await bubbleFacts())?.text)}`);
shots.push(await shot(cdp, SH('2b-hover-value-clear'), geoB ? { x: 0, y: Math.max(0, geoB.y - 8), width: 460, height: 96 } : undefined, 2));
await revealRow(SOURCE);

// ③ 悬停标签名 → 档案卡片(一行一条关系)
await hoverInside(SOURCE, `r.querySelector('span.shrink-0.truncate')`);
await sleep(500);
const card = await bubbleFacts();
log(`INFO 行 data-tip 标题=${JSON.stringify(String(await rowTipOf(cdp, SOURCE)).split('\n'))}`);
log(`INFO 卡片左列=${JSON.stringify(card?.labels)} 右列=${JSON.stringify(card?.values)}`);
shots.push(await shot(cdp, SH('3-hover-card'), geo ? { x: 0, y: Math.max(0, geo.y - 10), width: 720, height: 250 } : undefined, 2));

// ④ 两条关系的标签:卡片两行(第二条无属性名 = 回退左列显示目标名)
const geo2 = await revealRow(CARD_MULTI);
await hoverInside(CARD_MULTI, `r.querySelector('span.shrink-0.truncate')`);
await sleep(500);
const card2 = await bubbleFacts();
log(`INFO 多关系卡片左列=${JSON.stringify(card2?.labels)} 右列=${JSON.stringify(card2?.values)}`);
shots.push(await shot(cdp, SH('4-card-multi'), geo2 ? { x: 0, y: Math.max(0, geo2.y - 10), width: 720, height: 270 } : undefined, 2));

log('INFO 截图:' + shots.join(' '));
conn.close();
