#!/usr/bin/env node
/**
 * 暗色主题(P4)三态端到端验收:即时生效 / 输入栏跟随 / 跟随系统 / 重启保持 / 还原。
 * 用法: node scripts/dev-cdp-accept-theme.mjs [phase1|phase2]   (先以 9222 启动 pnpm tauri dev;冷启动即可 —— 主窗由 ensureMain 前置自动打开)
 *   phase1(默认):设置页三态切换即时生效 + 输入栏跟随 + system 态随系统深浅色变化;
 *                 结束时把主题留在「暗色」,供重启后验证持久化。
 *   phase2:重启 dev 后跑,验证主题重启保持;最后还原为「跟随系统」(与验收前一致)。
 * 读数口径:--color-app / --color-text 两个 CSS 变量的计算值 + 根节点 dark 类
 * (亮色 app=#ffffff;暗色 app=#1e1e1e),不靠肉眼看截图。
 */
import { ensureMain, open, recorder, sleep } from './cdp-lib.mjs';

const PHASE = process.argv[2] === 'phase2' ? 2 : 1;
const { record, finish } = recorder();

const { cdp: main, close: closeMain } = await ensureMain();
const { cdp: input, close: closeInput } = await open('input');

const PROBE = `(() => {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  return {
    dark: root.classList.contains('dark'),
    colorScheme: cs.colorScheme,
    app: cs.getPropertyValue('--color-app').trim(),
    text: cs.getPropertyValue('--color-text').trim(),
  };
})()`;
const probe = (cdp) => cdp.eval(PROBE);
const themeSetting = () => main.eval(`(async () => await window.__TAURI_INTERNALS__.invoke('get_setting', { key: 'theme' }))()`);
const radioSel = (mode) => `input[name="theme"][value="${mode}"]`;
const pick = (mode) => main.eval(`(() => {
  const r = document.querySelector(${JSON.stringify(radioSel(mode))});
  if (!r) return false;
  r.click();
  return true;
})()`);
const openSettings = () => main.eval(`(() => {
  const b = document.querySelector('button[aria-label="设置"]');
  if (b) { b.click(); return true; }
  return false;
})()`);
const emulate = (cdp, value) =>
  cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });

const LIGHT = { app: '#ffffff' };
const DARK = { app: '#1e1e1e' };

if (PHASE === 1) {
  // 1 设置页「外观」分区与三态单选
  await openSettings();
  await sleep(400);
  const ui = await main.eval(`(() => {
    const group = document.querySelector('[role="radiogroup"][aria-label="主题"]');
    const radios = group ? Array.from(group.querySelectorAll('input[name="theme"]')).map((r) => r.value + ':' + (r.checked ? 'selected' : '')) : null;
    const sections = Array.from(document.querySelectorAll('section h2')).map((h) => h.textContent.trim());
    return { radios, sections };
  })()`);
  record(
    '1 设置页外观分区三态单选(跟随系统/亮色/暗色)',
    JSON.stringify(ui.radios) === JSON.stringify(['system:selected', 'light:', 'dark:']),
    JSON.stringify(ui.radios) + ' 分区=' + JSON.stringify(ui.sections)
  );

  // 2 切暗色:即时生效 + 输入栏跟随
  const before = { main: await probe(main), input: await probe(input) };
  await pick('dark');
  await sleep(400);
  const darkMain = await probe(main);
  const darkInput = await probe(input);
  const darkSet = await themeSetting();
  record(
    '2 切暗色即时生效(主窗)',
    darkMain.dark === true && darkMain.app === DARK.app && darkMain.colorScheme === 'dark',
    JSON.stringify(darkMain) + ' 库内 theme=' + darkSet
  );
  record(
    '3 输入栏跟随主窗切暗色',
    darkInput.dark === true && darkInput.app === DARK.app,
    JSON.stringify(darkInput) + ' 主窗切前=' + JSON.stringify(before.input)
  );

  // 4 切亮色:两个窗口都回亮
  await pick('light');
  await sleep(400);
  const lightMain = await probe(main);
  const lightInput = await probe(input);
  record(
    '4 切亮色即时生效(主窗+输入栏)',
    lightMain.dark === false && lightMain.app === LIGHT.app && lightInput.dark === false && lightInput.app === LIGHT.app,
    JSON.stringify(lightMain) + ' ' + JSON.stringify(lightInput)
  );

  // 5 system 态:随系统深浅色即时变化(CDP 模拟 prefers-color-scheme)
  await pick('system');
  await sleep(300);
  await emulate(main, 'dark');
  await emulate(input, 'dark');
  await sleep(500);
  const sysDark = { main: await probe(main), input: await probe(input) };
  await emulate(main, 'light');
  await emulate(input, 'light');
  await sleep(500);
  const sysLight = { main: await probe(main), input: await probe(input) };
  record(
    '5 system 态跟随系统深浅色(两窗一致)',
    sysDark.main.dark === true && sysDark.input.dark === true && sysLight.main.dark === false && sysLight.input.dark === false,
    `模拟暗=${JSON.stringify(sysDark.main)} 模拟亮=${JSON.stringify(sysLight.main)}`
  );
  await main.send('Emulation.setEmulatedMedia', { features: [] });
  await input.send('Emulation.setEmulatedMedia', { features: [] });

  // 6 留在暗色,供 phase2 验证重启保持
  await pick('dark');
  await sleep(400);
  const kept = await probe(main);
  record('6 阶段收尾:主题写库为暗色(供重启验证)', kept.dark === true && (await themeSetting()) === 'dark', JSON.stringify(kept));
} else {
  // 7 重启后:根节点 dark 类与库内值一致(主窗)
  const after = await probe(main);
  const stored = await themeSetting();
  record(
    '7 重启后主窗保持暗色(dark 类 + 库内 theme=dark)',
    after.dark === true && after.app === DARK.app && stored === 'dark',
    JSON.stringify(after) + ' 库内 theme=' + stored
  );

  // 8 重启后输入栏也跟随(输入栏挂载时读库)
  const inputAfter = await probe(input);
  record(
    '8 重启后输入栏跟随暗色',
    inputAfter.dark === true && inputAfter.app === DARK.app,
    JSON.stringify(inputAfter)
  );

  // 9 还原为「跟随系统」(验收前的库内值),两窗同步回亮
  await openSettings();
  await sleep(400);
  await pick('system');
  await sleep(500);
  const restored = { main: await probe(main), input: await probe(input) };
  const restoredSetting = await themeSetting();
  record(
    '9 还原为跟随系统(主窗+输入栏,库内 theme=system)',
    restored.main.dark === false && restored.input.dark === false && restoredSetting === 'system',
    JSON.stringify(restored.main) + ' 库内 theme=' + restoredSetting
  );
}

finish();
closeMain();
closeInput();
