// 临时取证脚本(2026-10-07 主窗图标与菜单重排):5 张真机截图到 .superpowers/shots/icons-*。
// 用法:LIFELOG_CDP_PORT=9333 node scripts/dev-icons-shots.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { ensureMain, sleep, waitFor } from './cdp-lib.mjs';

const OUT = '.superpowers/shots';
mkdirSync(OUT, { recursive: true });

const { cdp } = await ensureMain();
await cdp.send('Page.enable');
const js = (e) => cdp.eval(e);
await cdp.send('Page.reload', { ignoreCache: false });
await sleep(2500);
await waitFor(() => js(`!!document.querySelector('#root [data-testid="unified-input"]')`), 40, 250);
await sleep(600);

const shot = async (name, clip) => {
  const r = await cdp.send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'));
  console.log('shot', name);
  return `${OUT}/${name}.png`;
};
const clipOf = (sel, pad = 8, h = null) =>
  js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x - ${pad}), y: Math.max(0, r.y - ${pad}), width: Math.min(r.width + ${pad * 2}, window.innerWidth), height: ${h} || r.height + ${pad * 2}, scale: 1 }; })()`);

// 确保侧栏可见
await js(`(() => { const b = document.querySelector('button[aria-label="显示侧栏"]'); if (b) b.click(); return true; })()`);
await sleep(400);

const out = [];
out.push(await shot('icons-01-topbar-stream'));
out.push(await shot('icons-04-condition-bar', await clipOf('[data-testid="condition-bar"]', 6)));
out.push(await shot('icons-05-sidebar-header', await clipOf('[data-testid="sidebar"]', 2, 60)));

// 关系图
await js(`(() => { document.querySelector('button[aria-label="关系图"]').click(); return true; })()`);
await waitFor(() => js(`!!document.querySelector('[data-testid="graph-view"]')`), 30, 250);
await sleep(900);
out.push(await shot('icons-02-graph'));

// 设置页
await js(`(() => { document.querySelector('button[aria-label="设置"]').click(); return true; })()`);
await waitFor(() => js(`!!document.querySelector('#root [role="tab"]')`), 30, 250);
await sleep(900);
out.push(await shot('icons-03-settings'));

console.log(JSON.stringify({ shots: out }));
cdp.close();
