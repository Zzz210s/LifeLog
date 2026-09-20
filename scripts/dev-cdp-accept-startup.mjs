#!/usr/bin/env node
/**
 * 首屏闪白与冷启动(E4)阶段 CDP 验收:冷启动只有输入栏 / 主窗按需创建 / 设置意图一次性 /
 * 主题镜像(切换回写、非法值与清空退化、首帧前落地)/ 既有功能零回归。
 * 前置:先停掉所有 LifeLog 实例,再以调试端口启动 dev(冷启动态必须没有 main webview):
 *   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 pnpm tauri dev
 * 用法: node scripts/dev-cdp-accept-startup.mjs --phase=main|cleanup
 *   main    = 基线洁净审计(不干净即中止)-> A 冷启动状态 / B-C 设置意图三条通道 /
 *             D 主题镜像与首帧插桩 / G 既有功能回归 -> 落运行清单
 *   cleanup = 按清单删净自建数据 + 还原 tabs_state/theme/镜像 + 收尾断言
 * 场景库(窗口/托盘取证件 + D/G 场景)在 scripts/dev-startup-scenes.mjs,
 * 数据安全件(库存/审计/清单/清收)在 scripts/dev-startup-clean.mjs(拆分只为满足 200 行规则)。
 */
import { mkdirSync } from 'node:fs';
import { open, pages, recorder, sleep, waitFor, bindMain, ensureMain } from './cdp-lib.mjs';
import { KEY, ON_SETTINGS, clickBack, os, runRegressScenes, runThemeScenes, setKeyword } from './dev-startup-scenes.mjs';
import {
  OUT, TEST_NOTE, auditBaseline, cleanupRun, dbInventory, writeJson,
} from './dev-startup-clean.mjs';

const phase = (process.argv.find((a) => a.startsWith('--phase=')) || '--phase=main').slice('--phase='.length);
const j = JSON.stringify;
const { record, finish } = recorder();

async function runMain() {
  mkdirSync(OUT, { recursive: true });
  const pid = os.pidOf();
  // A 冷启动:CDP 目标与 Win32 窗口都只有输入栏 + 基线洁净审计
  await waitFor(async () => (await pages()).find((p) => p.url.includes('input.html')) || null, 40, 250);
  const list0 = await pages();
  record('A1 冷启动后 CDP 目标只有输入栏(主窗 webview 未创建)',
    list0.length === 1 && list0[0].url.includes('input.html'), j(list0.map((p) => p.title + '|' + p.url)));
  const w0 = os.wins(pid);
  record('A2 顶层窗口只有输入栏(Win32 读数:不存在标题 拾枝 的主窗)',
    w0.some((w) => w.title === '输入栏') && !w0.some((w) => w.title === '拾枝'),
    j(w0.map((w) => w.title + ':' + w.visible)));
  const base = dbInventory();
  const problems = auditBaseline(base);
  record('A3 基线洁净审计(笔记首行/标签路径/tabs_state 引用无 AI 残留)',
    problems.length === 0, j({ problems, notes: base.notes, theme: base.theme }));
  if (problems.length > 0) {
    console.log('基线不干净,中止(拒绝把污染当基线)');
    finish();
    process.exit(1);
  }
  writeJson('inventory-before.json', base);
  const kw = [...base.ids[0].split('|')[1]].slice(-2).join('');

  // B 首次「设置」入口创建主窗 -> main 目标出现 + 直接落在设置页(mount 取 pending)
  const tOpen = Date.now();
  os.pickTray(pid, 3);
  const mainTarget = await waitFor(async () => (await pages()).find((p) => !p.url.includes('input.html')) || null, 60, 250);
  record('B1 托盘「设置」后 main 目标才出现(此前 CDP 列表里没有它)',
    !!mainTarget, j({ appearMs: Date.now() - tOpen, url: mainTarget && mainTarget.url }));
  const mp = await open('main');
  const ipa = await open('input');
  const { call, liCount, inventory } = bindMain(mp.cdp);
  const onSettings = () => mp.cdp.eval(ON_SETTINGS);
  const landed = await waitFor(async () => ((await onSettings()) ? true : null), 24, 250);
  record('B2 首次「设置」打开的主窗直接落在设置页(mount 取用 pending 意图)', landed === true, '');
  record('B3 pending 取走即清空(再取 = false)',
    (await call('take_pending_open_settings')) === false, '');

  // C1 窗口已存在时再「设置」-> 事件通道仍切到设置页
  const back = await clickBack(mp.cdp);
  const toStream = await waitFor(async () => ((await onSettings()) ? null : true), 12, 250);
  os.pickTray(pid, 3);
  const againSettings = await waitFor(async () => ((await onSettings()) ? true : null), 20, 250);
  record('C1 主窗已存在时托盘「设置」-> 仍切到设置页(事件通道)', back === true && toStream === true && againSettings === true,
    j({ back, toStream, againSettings }));
  // C2/C3 关闭 = 退到托盘;之后普通「打开主窗口」不该被残留 pending 切走
  const closed = os.closeWindow(pid, '拾枝');
  const hidden = await waitFor(async () => (os.winVisible(pid, '拾枝') ? null : true), 12, 250);
  record('C2 关闭主窗 = 退到托盘(WM_CLOSE 走应用 CloseRequested:窗口隐藏、webview 仍在)',
    closed.closed === true && hidden === true, j(closed));
  await mp.cdp.eval('location.reload()');
  await sleep(2600);
  await waitFor(async () => ((await onSettings()) ? null : true), 24, 250);
  os.pickTray(pid, 2);
  const shown = await waitFor(async () => (os.winVisible(pid, '拾枝') ? true : null), 20, 250);
  record('C3 之后普通「打开主窗口」:窗口显示但视图仍是信息流(pending 未残留,设置页只由设置入口驱动)',
    shown === true && (await onSettings()) === false, j({ shown, settings: await onSettings() }));

  await runThemeScenes({ mp, ipa, call, record, j, themeBefore: base.theme });
  const made = await runRegressScenes({ pid, mp, ipa, call, liCount, base, kw, record, j });

  const mid = await inventory();
  writeJson('run-manifest.json', {
    noteIds: [made.noteId].filter(Boolean),
    pathsBefore: base.paths, tabsStateBefore: base.tabsState, themeBefore: base.theme,
  });
  console.log('INFO 运行清单已落盘', j({ noteIds: [made.noteId], themeBefore: base.theme }));
  console.log('INFO 场景结束后库存', j({ notes: mid.notes, tabsState: mid.tabsState, theme: mid.theme }));
  mp.close();
  ipa.close();
}

async function runCleanup() {
  const pid = os.pidOf();
  const { cdp, close } = await ensureMain();
  const { call } = bindMain(cdp);
  await setKeyword(cdp, '');
  await sleep(1600); // 先等界面侧关键词防抖(300ms)+ tabs_state 节流(500ms)落定,之后恢复才是最后写者
  const after = await cleanupRun({ call, record, j });
  const rewrite = `(() => { localStorage.setItem(${j(KEY)}, ${j(after.theme)}); return localStorage.getItem(${j(KEY)}); })()`;
  const mainMirror = await cdp.eval(rewrite);
  let inputMirror = null;
  try {
    const ip = await open('input');
    inputMirror = await ip.cdp.eval(rewrite);
    ip.close();
  } catch (e) {
    record('清收5:输入栏镜像回写(输入栏不可达)', false, String(e).slice(0, 120));
  }
  record('清收5:两窗主题镜像回写为还原后的库内值(不留运行期残留)',
    mainMirror === after.theme && inputMirror === after.theme, j({ mainMirror, inputMirror, theme: after.theme }));
  console.log('INFO 清收后库存', j({ notes: after.notes, theme: after.theme, tabsState: after.tabsState, pid }));
  close();
}

if (phase === 'main') await runMain();
else if (phase === 'cleanup') await runCleanup();
else throw new Error('未知阶段:' + phase);
finish();
