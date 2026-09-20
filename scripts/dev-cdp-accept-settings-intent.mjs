#!/usr/bin/env node
/**
 * 托盘「设置」意图不丢的端到端取证(必须**冷启动** + 真实托盘 + 真实 IPC):
 *   S1 冷启动:CDP 里只有输入栏(主窗 webview 未创建)
 *   S2 托盘「打开主窗口」-> main 目标出现
 *   S3 不等页面收敛,立刻连点两次「设置」(窗口刚建、页面可能还没订阅事件)
 *   S4 页面收敛后停在设置页(pending 或事件任一通道生效)
 *   S5 点「返回信息流」回到信息流
 *   S6 页面重载后不等收敛再点一次「设置」-> 仍落在设置页(已存在但未订阅的兜底通道)
 *   S7 回信息流后再点托盘「打开主窗口」-> 仍在信息流(pending 未残留)
 * 用法(冷启动态,不要先手动打开主窗):
 *   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 pnpm tauri dev
 *   node scripts/dev-cdp-accept-settings-intent.mjs
 * 只读用例:切视图不写库(库存靠前后对照证明)。
 */
import { open, pages, recorder, sleep, waitFor } from './cdp-lib.mjs';
import { os } from './cdp-os.mjs';

const r = recorder();
const pid = os.pidOf();
const j = JSON.stringify;
const isMain = (p) => !p.url.includes('input.html') && (p.url.includes('5173') || p.url.includes('tauri.localhost'));
/** 设置页判定:只有设置态顶栏才有「返回信息流」按钮 */
const ON_SETTINGS = `Array.from(document.querySelectorAll('button')).some((b) => b.textContent.trim() === '返回信息流')`;
const clickBack = (cdp) => cdp.eval(`(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === '返回信息流');
  if (b) { b.click(); return true; }
  return false;
})()`);
const onSettings = (cdp) => cdp.eval(ON_SETTINGS).catch(() => false);
/** 信息流外壳(齿轮)是否已挂载:用于区分「落在信息流」与「页面根本没挂载」 */
const probe = (cdp) => cdp.eval(`(() => ({
  settings: Array.from(document.querySelectorAll('button')).some((b) => b.textContent.trim() === '返回信息流'),
  gear: !!document.querySelector('button[aria-label="设置"]'),
  ready: document.readyState,
}))()`).catch(() => null);

// S1 冷启动前置:没有 main 目标(否则本用例无意义,提示重启 dev)
const list0 = await pages();
const cold = list0.length === 1 && list0[0].url.includes('input.html');
r.record('S1 冷启动前置:CDP 目标只有输入栏(主窗 webview 尚未创建)', cold, j(list0.map((p) => p.title + '|' + p.url)));
if (!cold) {
  console.log('INFO 需要冷启动:请重启 dev 后重跑(不要先手动打开主窗)');
  r.finish();
  process.exit(1);
}

// S2 托盘「打开主窗口」-> main 目标出现(快轮询,尽量在页面收敛前拿到连接)
os.pickTray(pid, 2);
const target = await waitFor(async () => (await pages()).find(isMain) || null, 60, 100);
r.record('S2 托盘「打开主窗口」后 main 目标出现', !!target, j({ url: target && target.url }));

// S3/S4 不等收敛,立刻连点两次「设置」
os.pickTray(pid, 3);
os.pickTray(pid, 3);
const conn = await open('main');
await waitFor(async () => ((await onSettings(conn.cdp)) ? true : null), 40, 250);
r.record('S3+S4 连点两次「设置」后最终停在设置页(pending/事件任一通道生效)',
  (await onSettings(conn.cdp)) === true, '');

// S5 返回信息流
const back = await clickBack(conn.cdp);
const stream = await waitFor(async () => ((await onSettings(conn.cdp)) ? null : true), 16, 250);
r.record('S5 点「返回信息流」回到信息流', back === true && stream === true, j({ back, stream }));

// S6 页面重载(窗口已存在但页面未订阅)后立刻点一次「设置」-> 仍停在设置页
await conn.cdp.eval('location.reload()');
sleep(120);
os.pickTray(pid, 3);
const backToSettings = await waitFor(async () => ((await onSettings(conn.cdp)) ? true : null), 60, 250);
r.record('S6 重载后不等收敛点「设置」:仍停在设置页(已存在窗口但未订阅 -> pending 兜底)',
  backToSettings === true, '');

// S7 回信息流后再点普通「打开主窗口」-> 仍在信息流(pending 无残留)
await clickBack(conn.cdp);
await waitFor(async () => ((await onSettings(conn.cdp)) ? null : true), 16, 250);
os.pickTray(pid, 2);
await sleep(800);
const stillStream = (await onSettings(conn.cdp)) === false;
r.record('S7 随后普通「打开主窗口」:仍在信息流(pending 未被残留到下一次打开)', stillStream,
  j({ settings: await onSettings(conn.cdp) }));

// S8 确定性区分用例:用网络节流把 reload 拖慢,使「窗口已存在但页面必然还没订阅」成为事实
// (托盘点「设置」约 1.5s,而节流后的页面要 4s+ 才拿到模块)-> 事件必丢,只能靠 pending 兜底。
// 旧实现(已存在窗口只 emit)在本用例下会落回信息流;新实现应停在设置页。
await conn.cdp.send('Page.enable');
await conn.cdp.send('Network.enable');
const throttle = (latency) => conn.cdp.send('Network.emulateNetworkConditions', {
  offline: false, latency, downloadThroughput: -1, uploadThroughput: -1,
});
await throttle(4000);
await conn.cdp.send('Page.reload', {});
await sleep(150);
const duringLoad = await onSettings(conn.cdp);
os.pickTray(pid, 3);
await throttle(0);
const slowSettings = await waitFor(async () => ((await onSettings(conn.cdp)) ? true : null), 80, 250);
const slowState = await probe(conn.cdp);
r.record('S8 reload 期间(节流 4s,必然未订阅)点「设置」:事件被丢后仍由 pending 兜底停在设置页',
  duringLoad === false && slowSettings === true, j({ duringLoad, slowSettings, state: slowState }));

r.finish();
conn.close();
