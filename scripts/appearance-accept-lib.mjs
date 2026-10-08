// 「输入栏外观」真机读数的共用件:双窗 CDP 连接、输入栏读数、设置页交互、颜色与对账工具。
// 只提供读数与动作,不做断言 —— PASS/FAIL 判据留在读数脚本里,便于逐条定位。
import { ensureMain, open, sleep, waitFor, bindMain } from './cdp-lib.mjs';
import { bindDom } from './cdp-dom.mjs';
import { os } from './cdp-os.mjs';

export { sleep, waitFor };

/** 8 个外观键与默认序列化值(真源 src/shared/input-appearance.ts 的原语表) */
export const APPEARANCE_KEYS = [
  'input_bg', 'input_bg_dark', 'input_border', 'input_border_dark',
  'input_radius', 'input_shadow', 'input_bg_opacity', 'input_preset',
];
export const DEFAULTS = {
  input_bg: 'theme', input_bg_dark: 'theme', input_border: 'theme', input_border_dark: 'theme',
  input_radius: '0', input_shadow: '1', input_bg_opacity: '100', input_preset: 'sticker',
};

/** 打开主窗(冷启动经托盘)与输入栏,绑定 IPC 与 DOM */
export async function openBoth() {
  const mainPage = await ensureMain();
  const inputPage = await open('input');
  const m = bindMain(mainPage.cdp);
  return {
    mainPage, inputPage, pid: os.pidOf(), dom: bindDom(mainPage.cdp),
    call: m.call, inventory: m.inventory,
    sticker, settings,
  };
}

const TA = `document.querySelector('textarea[aria-label="输入栏内容"]')`;

/** 输入栏侧读数:内联 --sticker-* 变量 / .sticker-input 计算样式(先失焦,聚焦环会压过边框与阴影) */
export const sticker = {
  vars: (cdp) => cdp.eval(`(() => {
    const el = ${TA}?.parentElement; if (!el) return null;
    const get = (n) => el.style.getPropertyValue(n).trim();
    return { bg: get('--sticker-bg'), border: get('--sticker-border'), radius: get('--sticker-radius'), shadow: get('--sticker-shadow'), text: get('--sticker-text') };
  })()`),
  computed: (cdp) => cdp.eval(`(() => {
    const el = ${TA}; if (!el) return null;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, border: cs.borderTopColor, borderWidth: cs.borderTopWidth, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow, color: cs.color };
  })()`),
  show: (cdp) => cdp.eval(`(async () => { await window.__TAURI_INTERNALS__.invoke('show_input_bar'); return true; })()`),
};

/** 设置页「外观」段落(InputAppearanceSection 的 h3 所在 div)作为交互限定域 */
const SEC = `(() => { const h = [...document.querySelectorAll('h3')].find((x) => x.textContent.trim() === '外观'); return h ? h.parentElement : null; })()`;

/**
 * 切到某个设置分区(幂等):点分区导航项并等该分区外壳出现。
 * 2026-10-04 设置分区拆分后:主题三态单选在「外观」(id=appearance)分区,
 * 输入栏外观控件在「输入栏外观」(id=inputAppearance)分区 —— 旧脚本假设两者同屏,
 * 于是 SEC 永远找不到、所有控件动作静默落空(读数 1/2/4-8 超时)。每次动作前显式归位。
 */
async function goto(dom, id) {
  await waitFor(() => dom.evalIn(`!!document.querySelector('[data-section-nav="${id}"]')`), 20, 250);
  await dom.evalIn(`(() => { if (document.querySelector('[data-section="${id}"]')) return false;
    const b = document.querySelector('[data-section-nav="${id}"]'); if (b) b.click(); return !!b; })()`);
  return (await waitFor(() => dom.evalIn(`!!document.querySelector('[data-section="${id}"]')`), 20, 250)) === true;
}

export const settings = {
  /** 进设置页并切到「输入栏外观」分区(幂等) */
  async open(dom) {
    await dom.evalIn(`(() => { const b = document.querySelector('button[aria-label="设置"]'); if (b) b.click(); return true; })()`);
    await goto(dom, 'inputAppearance');
    return (await waitFor(() => dom.evalIn(`${SEC} !== null`), 20, 250)) === true;
  },
  /** 点段落里正文精确匹配的按钮(预设 / 阴影 / 亮暗页签共用) */
  async button(dom, label) {
    await goto(dom, 'inputAppearance');
    return dom.evalIn(`(() => { const sec = ${SEC}; if (!sec) return false;
      const b = [...sec.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
      if (!b) return false; b.click(); return true; })()`);
  },
  /** 一键套用某套预设(贴纸 / 极简 / 玻璃 / 纯色) */
  pickPreset(dom, label) { return this.button(dom, label); },
  /** 亮暗色值页签(亮色 | 暗色):只切正在编辑的那一份颜色 */
  switchTab(dom, label) { return this.button(dom, label); },
  /** 拖原生 range:原型 value setter + input/change 事件(React 的 onChange 才触发) */
  async setSlider(dom, label, value) {
    await goto(dom, 'inputAppearance');
    const selector = `input[type=range][aria-label="${label}"]`;
    return dom.evalIn(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(String(value))});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true; })()`);
  },
  /** 点色块开色盘 -> 点一格(透明格或某个颜色格);色盘项的 aria-label 见 color-popover */
  async pickColor(dom, rowLabel, cellAriaLabel) {
    await goto(dom, 'inputAppearance');
    const swatch = `button[aria-label="${rowLabel}"]`;
    const opened = await dom.evalIn(`(() => {
      const sec = ${SEC}; if (!sec) return false;
      const sw = sec.querySelector(${JSON.stringify(swatch)});
      if (!sw) return false; sw.click(); return true; })()`);
    if (!opened) return false;
    await sleep(150);
    const cell = `[role=menuitem][aria-label="${cellAriaLabel}"]`;
    return dom.evalIn(`(() => {
      const menu = [...document.querySelectorAll('[role=menu]')].find((m) => m.getAttribute('aria-label') === ${JSON.stringify(rowLabel + '色盘')});
      if (!menu) return false;
      const c = menu.querySelector(${JSON.stringify(cell)});
      if (!c) return false; c.click(); return true; })()`);
  },
  /** 主题三态(system|light|dark):主题控件已由 radio 改成 Segmented 按钮组
   *  (role=group aria-label=主题,按钮带 aria-pressed);在「外观」分区。 */
  async pickTheme(dom, mode) {
    await goto(dom, 'appearance');
    const label = { system: '跟随系统', light: '亮色', dark: '暗色' }[mode];
    if (!label) return false;
    return dom.evalIn(`(() => {
      const g = document.querySelector('[role="group"][aria-label="主题"]');
      if (!g) return false;
      const b = [...g.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
      if (!b) return false; b.click(); return true; })()`);
  },
  /** 点「恢复输入栏分区默认」-> 关原生确认框(python click-ok 点「确定」),返回 {found,buttons} 或 false */
  async resetDefaults(pid, dom) {
    await goto(dom, 'inputAppearance');
    // 分区默认按钮文案已随设置区拆分改成「恢复本分区默认」(真源 settings/SettingsSection.tsx),
    // 且在 `[data-section=inputAppearance]` 分区外壳的页脚;用该分区分域定位,不再用旧整页文案。
    const clicked = await dom.evalIn(`(() => {
      const sec = document.querySelector('[data-section="inputAppearance"]');
      if (!sec) return false;
      const b = [...sec.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith('恢复本分区默认'));
      if (!b) return false; b.click(); return true; })()`);
    if (!clicked) return false;
    // 只点标题为「恢复输入栏外观默认」的那个确认框(InputAppearancePanel 的 confirm title),
    // 免得撞上别的残留原生框;点完等它真的关掉再让调用方去等键回默认。
    for (let i = 0; i < 12; i++) {
      const r = os.clickOk(pid, '恢复输入栏外观默认');
      if (r && r.clicked) {
        await sleep(500);
        return { found: true, buttons: r.buttons };
      }
      await sleep(300);
    }
    return false;
  },
};

/** CSS 颜色 -> {r,g,b,a}:兼容 hex / rgb() / rgba() / color(srgb r g b / a)(Chromium 对 color-mix 的实测输出) */
export function toRgb(color) {
  const s = String(color).trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) { const v = parseInt(m[1], 16); return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255, a: 1 }; }
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) { const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; }
  m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/i.exec(s);
  if (m) { return { r: +m[1] * 255, g: +m[2] * 255, b: +m[3] * 255, a: m[4] ? +m[4] : 1 }; }
  return null;
}

/** 背景 alpha(0-1);取不到按 1("不透明") */
export function parseAlpha(color) { const c = toRgb(color); return c ? c.a : 1; }

const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function luminance(color) {
  const c = toRgb(color);
  if (!c) return 0;
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}
/** WCAG 对比度 1-21(与 src/shared/color-math.ts 同式;这里是真机读数侧的自算) */
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 8 键 raw 快照(get_setting;键缺失 -> null,与「写回默认值」等价,见对账口径) */
export async function snapshotKeys(call, keys = APPEARANCE_KEYS) {
  const out = {};
  for (const k of keys) out[k] = (await call('get_setting', { key: k })) ?? null;
  return out;
}
