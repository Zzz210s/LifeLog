// #36 验收:①守卫生效(close 只隐藏,webview 不销毁)②原生销毁后自愈重建 ③连续 2 轮
import { ensureMain, open, pages, sleep } from 'file:///F:/0-code/20-active/LifeLog/scripts/cdp-lib.mjs';
import { os } from 'file:///F:/0-code/20-active/LifeLog/scripts/cdp-os.mjs';
const titles = async () => (await pages()).map((p) => p.title);
// 托盘菜单第 2 项 =「打开主窗口」;pid 走 cdp-os 的 powershell 取法(与 ensureMain 同源),
// 不依赖 Git Bash 的 `bash -lc ps -W` —— 非 Git Bash 环境取到空串会让 win-tray.py 直接抛错崩掉脚本。
const tray = () => {
  const pid = os.pidOf();
  if (!pid) return '{"ok": false, "error": "no-pid"}';
  const r = os.pickTray(pid, 2);
  return r.stdout || String(r.stderr || '');
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
