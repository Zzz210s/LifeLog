// 令牌层契约:设计 §3 的令牌表必须逐项落在 src/shared/theme.css 里(亮暗两套 + 旧别名),
// 正文/次级对比度必须过 AA。设计表变了就同时改这里,防止令牌悄悄漂移。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync('src/shared/theme.css', 'utf8');

/** 取 marker(如 '@theme static {')后第一个 { 到配对 } 之间的文本 */
function blockOf(marker: string): string {
  const open = CSS.indexOf('{', CSS.indexOf(marker));
  let depth = 0;
  for (let i = open; i < CSS.length; i += 1) {
    if (CSS[i] === '{') depth += 1;
    else if (CSS[i] === '}' && (depth -= 1) === 0) return CSS.slice(open + 1, i);
  }
  throw new Error(`${marker} 块未闭合`);
}

/** 块内的自定义属性声明(同名后者覆盖前者;行尾注释在 ; 之后,不计入值) */
function decls(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

const LIGHT = decls(blockOf('@theme static {'));
const DARK = decls(blockOf('.dark {'));
/** 读一个令牌,缺失时给空串(断言信息里能看到令牌名) */
const token = (tokens: Map<string, string>, name: string) => tokens.get(name) ?? '';

/** §3.1 [令牌, 亮色, 暗色] */
const COLORS: ReadonlyArray<readonly [string, string, string]> = [
  ['--color-canvas', '#f6f6f7', '#1e1e1e'],
  ['--color-chrome', '#ffffff', '#252526'],
  ['--color-chrome-alt', '#ececee', '#2d2d30'],
  ['--color-raised', '#ffffff', '#252526'],
  ['--color-hover', '#efeff1', '#2a2d2e'],
  ['--color-selected', '#e8f1fd', '#264f78'],
  ['--color-accent', '#2563eb', '#007acc'],
  ['--color-accent-text', '#1d4ed8', '#60caff'],
  ['--color-accent-soft', '#e8f1fd', '#264f78'],
  ['--color-border', '#e3e5e8', '#3c3c3c'],
  ['--color-border-strong', '#cfd4d9', '#4a4a4a'],
  ['--color-text', '#1f2328', '#cccccc'],
  ['--color-muted', '#5e666f', '#9d9d9d'],
  ['--color-faint', '#7e868f', '#7a7a7a'],
];

/** 旧令牌名 -> 新档(别名只在亮色块里定义一次) */
const ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['--color-app', '--color-canvas'],
  ['--color-panel', '--color-chrome'],
  ['--color-tag', '--color-chrome-alt'],
  ['--color-active', '--color-selected'],
];

/** §3.1 表之外的既有语义色:两态都必须还在,组件不许留硬编码 */
const SEMANTIC: ReadonlyArray<string> = [
  '--color-danger', '--color-danger-soft', '--color-danger-hover', '--color-accent-hover',
  '--color-on-accent', '--color-on-danger', '--color-knob', '--color-overlay',
  '--color-success', '--color-warn', '--color-warn-soft',
];

/** §3.2 [令牌, 字号, 行高, 字重?] */
const TYPES: ReadonlyArray<readonly [string, string, string, string?]> = [
  ['--text-display', '20px', '28px', '600'],
  ['--text-title', '16px', '24px', '600'],
  ['--text-body', '15px', '26px'],
  ['--text-body-sm', '14px', '22px'],
  ['--text-ui', '13px', '18px'],
  ['--text-label', '12px', '16px'],
  ['--text-micro', '11px', '14px'],
];

/** §3.3 圆角/间距/动效:与主题无关,只在亮色块声明一次,暗色靠继承(不重复定义) */
const SHARED: ReadonlyArray<readonly [string, string]> = [
  ['--radius-xs', '4px'], ['--radius-sm', '6px'], ['--radius-md', '8px'], ['--radius-lg', '12px'],
  ['--space-1', '2px'], ['--space-2', '4px'], ['--space-3', '6px'], ['--space-4', '8px'],
  ['--space-5', '12px'], ['--space-6', '16px'], ['--space-7', '24px'], ['--space-8', '32px'],
  ['--dur-fast', '100ms'], ['--dur-base', '150ms'], ['--dur-slow', '220ms'],
  ['--ease-out', 'cubic-bezier(0.22, 1, 0.36, 1)'],
];

/** §3.3 浮层阴影:暗色按「.36 系」加深,故两态各一份 */
const SHADOWS: ReadonlyArray<readonly [string, string, string]> = [
  ['--shadow-sm', '0 1px 2px rgb(0 0 0 / 6%)', '0 1px 2px rgb(0 0 0 / 24%)'],
  ['--shadow-md', '0 4px 12px rgb(0 0 0 / 10%)', '0 4px 12px rgb(0 0 0 / 30%)'],
  ['--shadow-lg', '0 8px 24px rgb(0 0 0 / 16%)', '0 8px 24px rgb(0 0 0 / 36%)'],
];

/** sRGB 相对亮度(WCAG 2.x) */
function luminance(color: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** 对比度(前后景互换结果相同) */
function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES: ReadonlyArray<readonly [string, Map<string, string>]> = [
  ['亮色', LIGHT],
  ['暗色', DARK],
];
const SURFACES: ReadonlyArray<string> = [
  '--color-canvas', '--color-chrome', '--color-raised', '--color-chrome-alt',
];

describe('§3 令牌表', () => {
  it('§3.1 表面/边框/文本:亮暗两套与设计表逐项一致', () => {
    for (const [name, light, dark] of COLORS) {
      expect(token(LIGHT, name), `亮色 ${name}`).toBe(light);
      expect(token(DARK, name), `暗色 ${name}`).toBe(dark);
    }
  });

  it('亮色颜色令牌集合 = 设计表 + 旧别名 + 既有语义色(不丢也不多)', () => {
    const actual = [...LIGHT.keys()].filter((k) => k.startsWith('--color-')).sort();
    const expected = [...COLORS.map((r) => r[0]), ...ALIASES.map((r) => r[0]), ...SEMANTIC].sort();
    expect(actual).toEqual(expected);
  });

  it('旧令牌名保留为别名,且不在暗色里重复定义', () => {
    for (const [alias, target] of ALIASES) {
      expect(token(LIGHT, alias), alias).toBe(`var(${target})`);
      expect(DARK.has(alias), `暗色不应重复定义 ${alias}`).toBe(false);
    }
  });

  it('既有语义色两态都还在', () => {
    for (const name of SEMANTIC) {
      expect(token(LIGHT, name), `亮色 ${name}`).not.toBe('');
      expect(token(DARK, name), `暗色 ${name}`).not.toBe('');
    }
  });

  it('§3.2 类型刻度:字号/行高齐全,只有 display 与 title 带 600 字重', () => {
    for (const [name, size, leading, weight] of TYPES) {
      expect(token(LIGHT, name), name).toBe(size);
      expect(token(LIGHT, `${name}--line-height`), `${name} 行高`).toBe(leading);
      expect(LIGHT.has(`${name}--font-weight`), `${name} 字重`).toBe(weight !== undefined);
      if (weight) expect(token(LIGHT, `${name}--font-weight`), `${name} 字重`).toBe(weight);
    }
  });

  it('§3.3 圆角/间距/动效:取值一致且暗色不重复定义(靠继承)', () => {
    for (const [name, value] of SHARED) {
      expect(token(LIGHT, name), name).toBe(value);
      expect(DARK.has(name), `暗色不应重复定义 ${name}`).toBe(false);
    }
  });

  it('§3.3 浮层阴影:亮暗各一份,暗色按 .36 系加深', () => {
    for (const [name, light, dark] of SHADOWS) {
      expect(token(LIGHT, name), `亮色 ${name}`).toBe(light);
      expect(token(DARK, name), `暗色 ${name}`).toBe(dark);
    }
  });
});

describe('对比度(WCAG 2.x,阈值取设计 §3.1/§4-5)', () => {
  it('正文/次级在四种底色上 >= 4.5:1', () => {
    const rows: string[] = [];
    for (const [label, tokens] of THEMES) {
      for (const surface of SURFACES) {
        for (const fg of ['--color-text', '--color-muted']) {
          const ratio = contrast(token(tokens, fg), token(tokens, surface));
          rows.push(`${label} ${fg.slice('--color-'.length)} on ${surface.slice('--color-'.length)} = ${ratio.toFixed(2)}:1`);
          expect(ratio, `${label} ${fg} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
    console.log(`[对比度读数]\n${rows.join('\n')}`);
  });

  it('accent 作前景:canvas 与 accent-soft 上都 >= 4.5:1', () => {
    for (const [label, tokens] of THEMES) {
      for (const surface of ['--color-canvas', '--color-accent-soft']) {
        const ratio = contrast(token(tokens, '--color-accent-text'), token(tokens, surface));
        expect(ratio, `${label} accent-text on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('三级 faint 只作注记:3:1 <= 对比度 < 4.5:1,且源码两处都标注用途', () => {
    for (const [label, tokens] of THEMES) {
      const ratio = contrast(token(tokens, '--color-faint'), token(tokens, '--color-canvas'));
      expect(ratio, `${label} faint 下限`).toBeGreaterThanOrEqual(3);
      expect(ratio, `${label} faint 不可作正文`).toBeLessThan(4.5);
    }
    expect(CSS.match(/--color-faint: #[0-9a-f]{6}; \/\*[^\n]*只作注记[^\n]*\*\//g)?.length).toBe(2);
  });
});
