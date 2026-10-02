// CSS 变量合成:输入栏表面只认内联 --sticker-*(未设置时由 main.css 回退主题令牌)。
// T1 不产出 --sticker-text(自动字色是 S2/T2 的事)。
import { describe, expect, it } from 'vitest';
import { APPEARANCE_DEFAULTS, type InputAppearance } from './input-appearance';
import { pickTextInk } from './color-math';
import {
  SHADOWS,
  activeSurface,
  mixAlpha,
  resolveBorder,
  stickerStyleVars,
  surfaceBackground,
} from './sticker-style';

const ap = (patch: Partial<InputAppearance> = {}): InputAppearance => ({ ...APPEARANCE_DEFAULTS, ...patch });

describe('activeSurface', () => {
  it('亮色取 bg/border,暗色取 *_dark', () => {
    const a = ap({ bg: '#111111', bgDark: '#222222', border: '#333333', borderDark: '#444444' });
    expect(activeSurface(a, false)).toEqual({ bg: '#111111', border: '#333333' });
    expect(activeSurface(a, true)).toEqual({ bg: '#222222', border: '#444444' });
  });
});

describe('mixAlpha', () => {
  it('100 原样返回,<=0 透明,其余走 color-mix', () => {
    expect(mixAlpha('#123456', 100)).toBe('#123456');
    expect(mixAlpha('#123456', 40)).toBe('color-mix(in srgb, #123456 40%, transparent)');
    expect(mixAlpha('#123456', 0)).toBe('transparent');
    expect(mixAlpha('var(--color-raised)', 65)).toBe('color-mix(in srgb, var(--color-raised) 65%, transparent)');
  });
});

describe('surfaceBackground', () => {
  it('theme 用 raised 令牌,transparent 直接透,其余是 hex 与透明度合成', () => {
    expect(surfaceBackground('theme', 100)).toBe('var(--color-raised)');
    expect(surfaceBackground('transparent', 100)).toBe('transparent');
    expect(surfaceBackground('theme', 0)).toBe('transparent');
    expect(surfaceBackground('#123456', 40)).toBe('color-mix(in srgb, #123456 40%, transparent)');
  });
});

describe('resolveBorder', () => {
  it('theme / surface / transparent / hex 四种出路', () => {
    expect(resolveBorder('theme', '#123456', 40)).toBe('var(--color-border)');
    expect(resolveBorder('surface', '#123456', 40)).toBe(surfaceBackground('#123456', 40));
    expect(resolveBorder('surface', 'theme', 100)).toBe('var(--color-raised)');
    expect(resolveBorder('transparent', 'theme', 100)).toBe('transparent');
    expect(resolveBorder('#ef4444', 'theme', 100)).toBe('#ef4444');
  });
});

describe('stickerStyleVars', () => {
  it('默认原语 = 与今天一致,且不含 --sticker-text', () => {
    const vars = stickerStyleVars(ap(), false);
    expect(vars).toEqual({
      '--sticker-bg': 'var(--color-raised)',
      '--sticker-border': 'var(--color-border)',
      '--sticker-radius': '0px',
      '--sticker-shadow': SHADOWS[1],
    });
    expect(Object.keys(vars)).not.toContain('--sticker-text');
  });

  it('圆角带 px,阴影按档位取定值', () => {
    expect(stickerStyleVars(ap({ radius: 12 }), false)['--sticker-radius']).toBe('12px');
    expect(stickerStyleVars(ap({ shadow: 0 }), false)['--sticker-shadow']).toBe('none');
    expect(stickerStyleVars(ap({ shadow: 3 }), true)['--sticker-shadow']).toBe(SHADOWS[3]);
  });

  it('透明度只作用背景,边框不随之变淡(默认 border=theme)', () => {
    const vars = stickerStyleVars(ap({ bg: '#123456', opacity: 40 }), false);
    expect(vars['--sticker-bg']).toBe('color-mix(in srgb, #123456 40%, transparent)');
    expect(vars['--sticker-border']).toBe('var(--color-border)');
  });

  it('自定义底色按底色选墨色:深底给白字、浅底给黑字', () => {
    expect(stickerStyleVars(ap({ bg: '#123456' }), false)['--sticker-text']).toBe(pickTextInk('#123456'));
    expect(stickerStyleVars(ap({ bg: '#123456' }), false)['--sticker-text']).toBe('#ffffff');
    expect(stickerStyleVars(ap({ bg: '#f0f0f0' }), false)['--sticker-text']).toBe('#000000');
  });

  it('theme / transparent 底色不产出 --sticker-text(交给主题文字色回退)', () => {
    expect(Object.keys(stickerStyleVars(ap({ bg: 'theme' }), false))).not.toContain('--sticker-text');
    expect(Object.keys(stickerStyleVars(ap({ bg: 'transparent' }), false))).not.toContain('--sticker-text');
    expect(Object.keys(stickerStyleVars(ap({ bgDark: 'transparent' }), true))).not.toContain('--sticker-text');
  });

  it('透明度不改变字色判据:仍按纯底色(不是合成后的淡色)选墨', () => {
    const vars = stickerStyleVars(ap({ bg: '#1f2328', opacity: 40 }), false);
    expect(vars['--sticker-bg']).toBe('color-mix(in srgb, #1f2328 40%, transparent)');
    expect(vars['--sticker-text']).toBe('#ffffff');
  });
});
