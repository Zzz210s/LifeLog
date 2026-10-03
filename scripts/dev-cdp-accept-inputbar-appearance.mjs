#!/usr/bin/env node
/**
 * 「输入栏外观」真机读数(spec §8 的 1-8 + 只读对账):全部走设置页真实控件与另一窗口的计算样式,不碰物理鼠标。
 * 用法: node scripts/dev-cdp-accept-inputbar-appearance.mjs [--smoke]
 *   前置:以调试端口启动 —— dev: CDP 9222 上跑 pnpm tauri dev(本机 5173 落在 Windows 排除段,用 5199);
 *        装机版: 以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 启动 E:\1-LifeLog\LifeLog.exe。
 *   --smoke: 只跑读数 1/2/3(装机冒烟),末尾照样还原外观键与主题。
 * 对账口径:KV 只有 get_setting/set_setting、没有删除命令,故「回到基线」= 生效值一致(键缺失 ≡ 写回默认值):
 *   开头打印 8 键 raw 快照,结尾非空基线原样写回、空基线写回默认序列化值。
 */
import {
  openBoth, sticker, settings, parseAlpha, contrast, snapshotKeys, APPEARANCE_KEYS, DEFAULTS, waitFor,
} from './appearance-accept-lib.mjs';
import { recorder } from './cdp-lib.mjs';

const SMOKE = process.argv.includes('--smoke');
const { record, finish } = recorder();
const { mainPage, inputPage, call, dom, pid, inventory } = await openBoth();
const input = inputPage.cdp;
const vars = () => sticker.vars(input);
const comp = () => sticker.computed(input);
const keys = () => snapshotKeys(call, APPEARANCE_KEYS);
const j = (x) => JSON.stringify(x);
const eq = (a, b) => j(a) === j(b);
// 轮询输入栏两处读数都满足条件(变量写入与广播重载都是异步的)
const until = (want, tries = 16) =>
  waitFor(async () => { const v = await vars(); const c = await comp(); return want(v, c) ? { v, c } : null; }, tries, 250);

// 起始:记基线(用户原值 + 库存),主题固定亮色(读数 6/7 后还原),读一次「今日外观」作读数 8 的参照
const baseline = await keys();
const baselineTheme = (await call('get_setting', { key: 'theme' })) ?? null;
const inv0 = await inventory();
console.log('基线 8 键:', j(baseline), ' theme=', j(baselineTheme), ' 笔记=', inv0.notes);
await settings.open(dom);
await settings.pickTheme(dom, 'light');
await settings.switchTab(dom, '亮色');
await waitFor(async () => ((await comp())?.color === 'rgb(31, 35, 40)' ? true : null), 12, 250);
const baseStyle = await comp();

// ---------- 1 改底色 -> 输入栏实时变色 ----------
await settings.pickColor(dom, '底色', '颜色 #1f2328');
const r1 = await until((v, c) => v.bg === '#1f2328' && c.bg === 'rgb(31, 35, 40)');
record('1 设置页改底色 -> 输入栏实时变色', r1 !== null, r1 ? `--sticker-bg=${r1.v.bg} 计算=${r1.c.bg}` : '超时未同步');

// ---------- 2 透明度 100->40:背景 alpha 变、文字色逐字不变、对比度 >=4.5:1 ----------
const text100 = (await comp()).color;
await settings.setSlider(dom, '透明度', 40);
const r2 = await until((v, c) => Math.abs(parseAlpha(c.bg) - 0.4) < 0.03);
const text40 = (await comp()).color;
const ratio2 = r2 ? contrast(text40, '#1f2328') : 0;
record('2 透明度 100->40:背景 alpha 变、文字色逐字不变、对比度 >=4.5:1',
  r2 !== null && text40 === text100 && ratio2 >= 4.5,
  `alpha=${r2 ? parseAlpha(r2.c.bg).toFixed(2) : 'n/a'} 字色 ${text100} -> ${text40} 自算对比度=${ratio2.toFixed(2)}:1`);

// ---------- 3 选「透明」格:alpha 0、边框与阴影仍在、边界可辨 ----------
await settings.pickColor(dom, '底色', '透明');
const r3 = await until((v, c) => v.bg === 'transparent' && parseAlpha(c.bg) === 0);
const c3 = await comp();
record('3 选「透明」格:背景 alpha 0、边框与阴影仍在、边界可辨',
  r3 !== null && parseAlpha(r3.c.bg) === 0 && c3.border !== 'rgba(0, 0, 0, 0)' && c3.border === baseStyle.border
    && c3.shadow === baseStyle.shadow && parseFloat(c3.borderWidth) > 0,
  `alpha=${r3 ? parseAlpha(r3.c.bg) : 'n/a'} 边框=${c3.border}(基线 ${baseStyle.border}) 阴影=${c3.shadow} 边宽=${c3.borderWidth}(基线 ${baseStyle.borderWidth})`);

if (!SMOKE) {
  // ---------- 4 圆角 0/6/12 + 阴影四档 ----------
  const radii = {};
  for (const n of [0, 6, 12]) {
    await settings.setSlider(dom, '圆角', n);
    radii[n] = await waitFor(async () => { const c = await comp(); return c.radius === `${n}px` ? c.radius : null; }, 12, 250);
  }
  const SHADOW_EXPECT = { 无: /^none$/, 轻: /rgba\(0, 0, 0, 0\.1\)/, 中: /rgba\(0, 0, 0, 0\.18\)/, 强: /rgba\(0, 0, 0, 0\.26\)/ };
  const shadows = {};
  for (const label of ['无', '轻', '中', '强']) {
    await settings.button(dom, label);
    shadows[label] = await waitFor(async () => { const s = (await comp()).shadow; return SHADOW_EXPECT[label].test(s) ? s : null; }, 12, 250);
  }
  record('4 圆角 0/6/12 + 阴影四档各自生效',
    radii[0] === '0px' && radii[6] === '6px' && radii[12] === '12px'
      && Object.values(shadows).every((s) => s !== null) && new Set(Object.values(shadows)).size === 4,
    `圆角 ${j(radii)} 阴影 ${j(shadows)}`);

  // ---------- 5 四套预设逐个套用 + 手动改一项 -> custom ----------
  const PRESET_EXPECT = {
    贴纸: { input_bg: 'theme', input_bg_dark: 'theme', input_border: 'theme', input_border_dark: 'theme', input_radius: '0', input_shadow: '1', input_bg_opacity: '100', input_preset: 'sticker' },
    极简: { input_bg: 'theme', input_bg_dark: 'theme', input_border: 'transparent', input_border_dark: 'transparent', input_radius: '0', input_shadow: '0', input_bg_opacity: '100', input_preset: 'minimal' },
    玻璃: { input_bg: 'theme', input_bg_dark: 'theme', input_border: 'theme', input_border_dark: 'theme', input_radius: '12', input_shadow: '2', input_bg_opacity: '65', input_preset: 'glass' },
    纯色: { input_bg: 'theme', input_bg_dark: 'theme', input_border: 'surface', input_border_dark: 'surface', input_radius: '6', input_shadow: '1', input_bg_opacity: '100', input_preset: 'solid' },
  };
  const presetBad = [];
  for (const [label, want] of Object.entries(PRESET_EXPECT)) {
    await settings.button(dom, label);
    const got = await waitFor(async () => { const k = await keys(); return eq(k, want) ? k : null; }, 16, 250);
    if (!got) presetBad.push(`${label}=${j(await keys())}`);
  }
  await settings.setSlider(dom, '圆角', 10);
  const custom = await waitFor(async () => ((await call('get_setting', { key: 'input_preset' })) === 'custom' ? true : null), 12, 250);
  record('5 四套预设逐个套用(8 键按表写入)+ 手动改一项 -> preset=custom',
    presetBad.length === 0 && custom === true,
    presetBad.length ? presetBad.join(' ') : `四套全按表;圆角改 10 -> input_preset=${await call('get_setting', { key: 'input_preset' })}`);

  // ---------- 6 亮暗各存一份 + 切主题分别生效 ----------
  await settings.switchTab(dom, '亮色');
  await settings.pickColor(dom, '底色', '颜色 #2563eb');
  await settings.switchTab(dom, '暗色');
  await settings.pickColor(dom, '底色', '颜色 #ef4444');
  const stored = await waitFor(async () => { const k = await keys(); return k.input_bg === '#2563eb' && k.input_bg_dark === '#ef4444' && k.input_preset === 'custom' ? k : null; }, 12, 250);
  await settings.pickTheme(dom, 'light');
  const light = await until((v, c) => v.bg === '#2563eb' && c.bg === 'rgb(37, 99, 235)');
  await settings.pickTheme(dom, 'dark');
  const dark = await until((v, c) => v.bg === '#ef4444' && c.bg === 'rgb(239, 68, 68)');
  record('6 亮暗各存一份(亮 A / 暗 B)+ 切主题分别生效',
    stored !== null && light !== null && dark !== null,
    `库 亮=${stored?.input_bg} 暗=${stored?.input_bg_dark};输入栏 亮=${light?.c.bg} 暗=${dark?.c.bg}`);

  // ---------- 7 深色底 + 亮主题 -> 字色转浅且对比度 >=4.5:1 ----------
  await settings.pickTheme(dom, 'light');
  await settings.switchTab(dom, '亮色');
  await settings.pickColor(dom, '底色', '颜色 #1f2328');
  const r7 = await until((v, c) => v.text === '#ffffff' && c.color === 'rgb(255, 255, 255)');
  const ratio7 = r7 ? contrast(r7.c.color, '#1f2328') : 0;
  record('7 深色底 + 亮主题 -> 字色自动转浅且对比度 >=4.5:1',
    r7 !== null && ratio7 >= 4.5,
    `--sticker-text=${r7?.v.text} 计算字色=${r7?.c.color} 自算对比度=${ratio7.toFixed(2)}:1`);

  // ---------- 8 「恢复默认」-> 8 键回默认且计算样式与基线逐字段相等 ----------
  const resetRes = await settings.resetDefaults(pid, dom);
  const keysBack = await waitFor(async () => (eq(await keys(), DEFAULTS) ? true : null), 20, 300);
  const styleBack = await waitFor(async () => (eq(await comp(), baseStyle) ? true : null), 12, 250);
  record('8 「恢复默认」-> 8 键回默认 + 计算样式与基线逐字段相等',
    resetRes !== false && keysBack === true && styleBack === true,
    `确认框=${resetRes ? '已点确定' : '未出现'} 键=${keysBack ? '=默认' : j(await keys())} 样式=${styleBack ? '=基线' : j(await comp())}`);
}

// ---------- 9 只读对账:外观键回基线(+ 库存不变) ----------
for (const k of APPEARANCE_KEYS) await call('set_setting', { key: k, value: baseline[k] ?? DEFAULTS[k] });
await settings.pickTheme(dom, baselineTheme ?? 'system');
const finalKeys = await keys();
const diffs = APPEARANCE_KEYS.filter((k) => finalKeys[k] !== (baseline[k] ?? DEFAULTS[k]));
const inv1 = await inventory();
record('9 只读对账:8 个外观键回到基线 + 库存(笔记/标签/主题)不变',
  diffs.length === 0 && inv1.notes === inv0.notes && j(inv1.paths) === j(inv0.paths) && inv1.theme === inv0.theme,
  `键=${diffs.length ? diffs.map((k) => `${k}:${finalKeys[k]}`).join(',') : '全部一致'} 笔记 ${inv1.notes}/${inv0.notes} 标签同=${j(inv1.paths) === j(inv0.paths)} theme ${inv1.theme}/${inv0.theme}`);

finish();
// 把界面带回信息流:脚本会在设置页操作,留在那里会让后续门禁(表格视觉/视觉令牌)
// 读到隐藏的 0px 卡片而假失败(2026-10-03 实测)。设置页的退出通道是顶栏那个按钮。
await mainPage
  .eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '返回信息流'); if (b) b.click(); return !!b; })()`)
  .catch(() => {});
await sleep(400);
mainPage.close();
inputPage.close();
