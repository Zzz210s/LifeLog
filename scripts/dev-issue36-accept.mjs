// #36 验收:①守卫生效(close 只隐藏,webview 不销毁)②原生销毁后自愈重建 ③连续 2 轮
import { ensureMain, open, pages, sleep } from 'file:///F:/0-code/20-active/LifeLog/scripts/cdp-lib.mjs';
import { execFileSync } from 'node:child_process';
const titles = async () => (await pages()).map((p) => p.title);
const tray = () => {
  const winpid = execFileSync('bash', ['-lc', "ps -W | grep -i lifelog.exe | awk '{print $4}' | head -1"], { encoding: 'utf-8' }).trim();
  return execFileSync('python', ['scripts/win-tray.py', 'pick', winpid, '2'], { cwd: 'F:/0-code/20-active/LifeLog', encoding: 'utf-8', timeout: 30000 });
};
const conn = await ensureMain();
await sleep(6000); // 越过建窗豁免期
const round = async (label, useRaw) => {
  const main = await open('main');
  const js = useRaw ? 'window.__rawClose()' : 'window.close()';
  const r = await main.cdp.eval(`(() => { ${js}; return 'called'; })()`).catch((e) => 'err:' + e.message.slice(0, 40));
  await sleep(1200);
  const after = await titles();
  const out = await tray();
  await sleep(2500);
  const back = await titles();
  let cards = null, ipc = null;
  if (back.some((t) => t.includes('拾枝'))) {
    const m2 = await open('main');
    cards = await m2.cdp.eval(`document.querySelectorAll('li .md-body').length`).catch(() => null);
    ipc = await m2.cdp.eval(`(async () => (await window.__TAURI_INTERNALS__.invoke('get_db_info')).notes)()`).catch(() => null);
  }
  console.log(label, JSON.stringify({ call: r, afterClose: after, trayOk: /"ok": true/.test(out), back, cards, ipc }));
};
await round('① 守卫路径', false);
await round('② 原生销毁后自愈', true);
await round('③ 再来一轮守卫', false);
conn.close?.();
process.exit(0);
