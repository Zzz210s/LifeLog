#!/usr/bin/env node
/**
 * 首次使用引导的端到端验收(计划 Task 4 的读数)。
 *
 *   ① 未看过时**主窗自己出现**(不经托盘)且教程停在第 1 步
 *   ② 洞口矩形 = 锚点矩形外扩 4px(四块遮罩拼出)
 *   ③ 连点「下一步」到末步 -> 「完成」-> 覆盖层消失 + ui.tutorial_seen === '1'
 *   ④ 已看过时重启**不弹**(CDP 里只有输入栏,主窗 webview 未创建)
 *   ⑤ 托盘打开主窗 -> 设置页「重新观看」-> 引导回来且在第 1 步
 *   ⑥ 隐藏侧栏后重看:第 3 步的前置动作把侧栏显示出来,且真的停在「标签就是分类」
 *   ⑦ 洞口/气泡与**输入栏窗口**(永远置顶)不重叠 —— 否则引导会被贴纸窗盖住
 *   ⑧ 引导期间不写库:笔记数与标签路径前后一致(除了设置键)
 *
 * 前置:无需先起应用(脚本自己重启),但要给出可执行文件路径:
 *   node scripts/dev-tutorial-accept.mjs [exe路径]     默认 E:/1-LifeLog/LifeLog.exe
 * 端口用 LIFELOG_CDP_PORT(默认 9222)。
 *
 * 开窗发生在 **Rust 启动路径**(读 ui.tutorial_seen 后自己开主窗)—— 早期版本从前端 IPC 命令里建窗
 * 会把主线程卡死(窗口停在 about:blank、后续 IPC 永不返回),所以这里也不从页面里调开窗。
 * 脚本写 `ui.tutorial_seen`(结束复原为 '1')与 `sidebar_visible`(结束复原原值),不写笔记。
 */
import { recorder, sleep, waitFor } from './cdp-lib.mjs';
import { os } from './cdp-os.mjs';
import {
  HOLE_RECT, call, callOn, click, clickBy, inventory, mainTarget, mark, readMain, restart, withTimeout, windowRects,
} from './tutorial-accept-lib.mjs';

const EXE = process.argv[2] ?? 'E:/1-LifeLog/LifeLog.exe';
const KEY = 'ui.tutorial_seen';
const { record, finish } = recorder();
const overlap = (a, b) => a != null && b != null && a.left < b[2] && b[0] < a.left + a.width && a.top < b[3] && b[1] < a.top + a.height;

// ---------- 前置:清标记(此时主窗可能不存在,故走输入栏页面) ----------
if (!(await restart(EXE))) throw new Error('应用没起来(调试端口未就绪)');
await callOn('input', 'set_setting', { key: KEY, value: '' });
record('前置:标记已清空(输入栏页面写库)', (await callOn('input', 'get_setting', { key: KEY })) === '', '');

// ---------- ① 主窗自己出现 + 第 1 步 ----------
await restart(EXE);
const appeared = await waitFor(async () => ((await mainTarget()) ? true : null), 80, 500);
record('① 未看过时主窗自己出现(不经托盘)', appeared === true, `等待 ${appeared ? '到位' : '超时'}`);
await waitFor(async () => ((await readMain())?.open ? true : null), 60, 500);
const s1 = await readMain();
record('①b 教程停在第 1 步', s1 != null && s1.open === true && (s1.step ?? '').includes('1 / 4'), JSON.stringify({ step: s1?.step, title: s1?.title }));

// ---------- ② 洞口 = 锚点外扩 4px ----------
const anchor = s1?.anchorRect ?? null;
const expected = anchor == null ? null : { top: anchor.top - 4, left: anchor.left - 4, width: anchor.width + 8, height: anchor.height + 8 };
const page = await (await import('./cdp-lib.mjs')).open('main');
const holeRect = await withTimeout(page.cdp.eval(HOLE_RECT), 8000);
const fit = (a, b) => a != null && b != null && ['top', 'left', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) <= 2);
record('② 洞口矩形 = 锚点外扩 4px(四块遮罩拼出)', fit(holeRect, expected), JSON.stringify({ hole: holeRect, expected }));

// ---------- ⑦ 与输入栏窗口不重叠(它 alwaysOnTop) ----------
const wins = await windowRects();
const inputWin = wins.find((w) => w.title === '输入栏' && w.visible) ?? null;
const covered = inputWin != null && (overlap(s1?.bubbleRect ?? null, inputWin.rect) || overlap(holeRect, inputWin.rect));
record('⑦ 洞口/气泡不被输入栏窗口盖住', inputWin != null && covered === false, JSON.stringify({ input: inputWin?.rect ?? null, hole: holeRect, bubble: s1?.bubbleRect ?? null }));

// ---------- ⑧ 库存快照(引导期间不该写库) ----------
const before = await inventory();
const sidebarVisibleBefore = await call('get_setting', { key: 'sidebar_visible' });

// ---------- ③ 走完 -> 写标记(4 步:从第 1 步连点 3 次到末步) ----------
for (let i = 0; i < 3; i++) await click('tutorial-next');
const lastBtn = await withTimeout(
  page.cdp.eval(`(() => { const b = document.querySelector('[data-testid="tutorial-next"]'); return b === null ? null : b.textContent; })()`),
  8000
);
const atLast = await readMain();
record('③a 末步按钮是「完成」', lastBtn === '完成' && (atLast?.step ?? '').includes('4 / 4'), JSON.stringify({ step: atLast?.step, btn: lastBtn }));
await click('tutorial-next');
await sleep(700);
const after = await readMain();
const seen = await call('get_setting', { key: KEY });
// 读不到主窗(readMain 返回 null)不算通过:别让"页面不可达"伪装成"覆盖层已消失"
record('③b 完成后覆盖层消失且标记为 1', after != null && after.open === false && after.bands === 0 && seen === '1', JSON.stringify({ open: after?.open, bands: after?.bands, seen }));

// ---------- ⑧ 库存前后一致 ----------
const post = await inventory();
record(
  '⑧ 引导期间没写笔记/标签(库存前后一致)',
  before.notes === post.notes && JSON.stringify(before.paths) === JSON.stringify(post.paths),
  JSON.stringify({ notes: `${before.notes} -> ${post.notes}`, paths: `${before.paths.length} -> ${post.paths.length}` })
);

// ---------- ④ 再重启:不弹 ----------
await restart(EXE);
await sleep(4000);
const list = await (await import('./cdp-lib.mjs')).pages();
record('④ 已看过时重启不弹(CDP 只有输入栏)', list.length === 1 && list[0].url.includes('input.html'), JSON.stringify(list.map((p) => p.url)));

// ---------- ⑤ 设置页「重新观看」 ----------
os.pickTray(os.pidOf(), 2); // 托盘「打开主窗口」
await waitFor(async () => ((await mainTarget()) ? true : null), 60, 500);
await (await import('./cdp-lib.mjs')).ensureMain();
await sleep(600);
await clickBy('label', '设置');
await sleep(900);
const replay = await clickBy('text', '重新观看');
await sleep(1400);
const s5 = await readMain();
record('⑤ 设置页「重新观看」-> 引导回来且在第 1 步', replay === true && s5 != null && s5.open === true && (s5.step ?? '').includes('1 / 4'), JSON.stringify({ replay, step: s5?.step }));

// ---------- ⑥ 侧栏隐藏时的第 3 步 ----------
await clickBy('label', '隐藏侧栏');
await sleep(700);
const hidden = await readMain();
await click('tutorial-skip'); // 退出当前引导
await sleep(500);
await clickBy('label', '设置');
await sleep(900);
await clickBy('text', '重新观看');
await sleep(1600);
await click('tutorial-next'); // 第 1 步 -> 第 2 步(前缀提示在场)
await click('tutorial-next'); // -> 第 3 步(标签;锚点因侧栏隐藏而缺失,靠前置动作救回)
const s6 = await readMain();
record(
  '⑥ 侧栏隐藏后重看:前置动作把侧栏显示出来并停在第 3 步',
  hidden != null && hidden.sidebarVisible === false && s6 != null && s6.sidebarVisible === true && (s6.step ?? '').includes('3 / 4'),
  JSON.stringify({ beforeHide: hidden?.sidebarVisible, after: s6?.sidebarVisible, step: s6?.step })
);

// ---------- 收尾:复原标记与侧栏可见性 ----------
await click('tutorial-skip');
await sleep(500);
await mark('1');
if (sidebarVisibleBefore != null) await call('set_setting', { key: 'sidebar_visible', value: sidebarVisibleBefore });
const final = await readMain();
record('收尾:标记复原为 1、侧栏可见性复原、覆盖层已退出', final != null && final.open === false, JSON.stringify({ sidebar: sidebarVisibleBefore }));

finish();
