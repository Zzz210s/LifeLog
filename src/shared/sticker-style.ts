// 外观 -> CSS 变量:内联写在输入栏根 div 上,`.sticker-input` 继承(见 input-bar/main.css)。
// 未设置的项由 main.css 的 var(--sticker-*, 主题令牌) 回退,保持与今天一致。
// 底色是自定义色时追加 --sticker-text(按底色选墨,保证对比度 ≥4.5:1);theme/transparent 不产出。
import { pickTextInk } from './color-math';
import type { BorderColor, InputAppearance, SurfaceColor } from './input-appearance';

export interface StickerStyle {
  '--sticker-bg': string;
  '--sticker-border': string;
  '--sticker-radius': string;
  '--sticker-shadow': string;
  '--sticker-text'?: string;
}

/** 四档阴影定值(0=无,与 main.css 今日那条同值的是 index 1) */
export const SHADOWS = [
  'none',
  '0 2px 10px rgb(0 0 0 / 10%)',
  '0 4px 16px rgb(0 0 0 / 18%)',
  '0 8px 28px rgb(0 0 0 / 26%)',
] as const;

/** 亮暗各取一份颜色 */
export function activeSurface(
  a: InputAppearance,
  dark: boolean,
): { bg: SurfaceColor; border: BorderColor } {
  return { bg: dark ? a.bgDark : a.bg, border: dark ? a.borderDark : a.border };
}

/** 100% 原样;<=0 全透明;其余用 color-mix 表达 alpha(与既有聚焦光晕同一手法) */
export function mixAlpha(base: string, percent: number): string {
  if (percent >= 100) return base;
  if (percent <= 0) return 'transparent';
  return `color-mix(in srgb, ${base} ${percent}%, transparent)`;
}

export function surfaceBackground(bg: SurfaceColor, opacityPercent: number): string {
  if (bg === 'transparent') return 'transparent';
  return mixAlpha(bg === 'theme' ? 'var(--color-raised)' : bg, opacityPercent);
}

export function resolveBorder(border: BorderColor, bg: SurfaceColor, opacityPercent: number): string {
  if (border === 'transparent') return 'transparent';
  if (border === 'surface') return surfaceBackground(bg, opacityPercent);
  return border === 'theme' ? 'var(--color-border)' : border;
}

export function stickerStyleVars(a: InputAppearance, dark: boolean): StickerStyle {
  const { bg, border } = activeSurface(a, dark);
  const vars: StickerStyle = {
    '--sticker-bg': surfaceBackground(bg, a.opacity),
    '--sticker-border': resolveBorder(border, bg, a.opacity),
    '--sticker-radius': `${a.radius}px`,
    '--sticker-shadow': SHADOWS[a.shadow] ?? SHADOWS[0],
  };
  // 字色按**纯底色**选(不受透明度影响);跟随主题/全透明时交给 var(--color-text) 回退
  if (bg !== 'theme' && bg !== 'transparent') vars['--sticker-text'] = pickTextInk(bg);
  return vars;
}
