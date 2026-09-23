// @vitest-environment node
/**
 * 视觉刷新 V5「侧栏行 / 浮层 / 对话框 / 设置页」的门禁式源码扫描(不渲染,只读 className 文本)。
 *
 * V4 的门禁把 palette/、filter/ExprDialog、TagPickDialog、AddConditionMenu、sidebar/TagMenu*、
 * TagRow、settings/controls 这些文件全部标成「归 V5」跳过;本文件就是那份欠账的收口:
 * - 字号:只允许 7 档令牌(text-display/title/body/body-sm/ui/label/micro),禁 text-xs/sm/base/lg/[Npx]
 * - 圆角:只允许 rounded-xs/sm/md/lg(+ 开关的 rounded-full,单列例外)
 * - 按钮/输入:不再出现 h-6 这类旧档与 rounded-md
 * - 浮层:容器 rounded-lg + (shadow-lg 或 overlay-scrim);模态层必须有 bg-overlay 遮罩
 * - 对比度:白底不用 text-faint,只有 placeholder: 与 disabled: 两处豁免
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = 'src/main-window';

/** V5 改动到的文件(相对 src/main-window) */
const FILES = [
  'palette/Palette.tsx',
  'palette/PaletteRow.tsx',
  'filter/ExprDialog.tsx',
  'filter/ExprSyntaxHint.tsx',
  'filter/TagPickDialog.tsx',
  'filter/AddConditionMenu.tsx',
  'sidebar/TagRow.tsx',
  'sidebar/TagsHeader.tsx',
  'sidebar/TagsSection.tsx',
  'sidebar/TagRootDropBar.tsx',
  'sidebar/TagMenu.tsx',
  'sidebar/TagMenuMainPane.tsx',
  'sidebar/TagMenuRenamePane.tsx',
  'sidebar/TagMenuAliasPane.tsx',
  'sidebar/TagMenuMovePane.tsx',
  'sidebar/TagMenuMergePane.tsx',
  'sidebar/TagMenuDeletePane.tsx',
  'sidebar/tag-menu-ui.ts',
  'settings/SettingsView.tsx',
  'settings/controls.tsx',
  'settings/AppearanceSection.tsx',
  'settings/InputBarSection.tsx',
  'settings/NotesSection.tsx',
  'settings/StartupSection.tsx',
  'settings/GeneralSection.tsx',
  'settings/HotkeyRecorder.tsx',
  'shell/button-classes.ts',
] as const;

/** 浮层容器(需 rounded-lg + 阴影或遮罩):文件 -> 期望的容器类名片段 */
const FLOATS: Array<[string, string]> = [
  ['palette/Palette.tsx', 'overlay-scrim'],
  ['filter/ExprDialog.tsx', 'role="dialog"'],
  ['filter/TagPickDialog.tsx', 'role="dialog"'],
  ['filter/AddConditionMenu.tsx', 'role="menu"'],
  ['sidebar/TagMenu.tsx', 'role="menu"'],
];

/** 有模态遮罩的文件(浮层外壳 bg-overlay 或纯 CSS 的 overlay-scrim) */
const SCRIMS: Array<[string, string]> = [
  ['palette/Palette.tsx', 'overlay-scrim'],
  ['filter/ExprDialog.tsx', 'bg-overlay'],
  ['filter/TagPickDialog.tsx', 'bg-overlay'],
];

const src = (file: string): string => readFileSync(`${ROOT}/${file}`, 'utf8');
/** 去掉注释后的源码(注释里可以自由提到类名,不算命中) */
const code = (file: string): string =>
  src(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** 取某个标签的所有 className 表达式(含字符串模板里的两段) */
function classExprs(text: string, tag: string): string[] {
  const out: string[] = [];
  let i = text.indexOf(`<${tag}`);
  while (i >= 0) {
    const seg = text.slice(i, i + 900);
    const m = /className=(?:\{([\s\S]{0,400}?)\}|"([^"]*)")/.exec(seg);
    if (m) out.push((m[1] ?? m[2]).replace(/\s+/g, ' ').trim());
    i = text.indexOf(`<${tag}`, i + tag.length + 1);
  }
  return out;
}

/** 越档字号类:text-xs/sm/base/lg/xl/text-[Npx] */
const OFF_SCALE_TYPE = /\btext-(?:xs|sm|base|lg|xl|2xl|\d|\[)/g;
const allClassExprs = (file: string): string[] => code(file).match(/className=(?:\{[\s\S]{0,400}?\}|"[^"]*")/g) ?? [];

describe('V5 门禁:字号只用 7 档令牌', () => {
  it(`V5 文件(${FILES.length} 个)的 className 里没有越档字号类`, () => {
    const bad: string[] = [];
    for (const file of FILES) {
      for (const expr of allClassExprs(file)) {
        for (const hit of expr.match(OFF_SCALE_TYPE) ?? []) bad.push(`${file} | ${hit} | ${expr.slice(0, 90)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('V5 门禁:圆角只取刻度', () => {
  it('rounded-xs/sm/md/lg 之外没有其它圆角(rounded-full 仅限设置页开关)', () => {
    const bad: string[] = [];
    for (const file of FILES) {
      for (const expr of allClassExprs(file)) {
        for (const hit of expr.match(/rounded(?!-(?:xs|sm|md|lg)\b)[\w[\]%.-]*/g) ?? []) {
          if (file === 'settings/controls.tsx' && hit === 'rounded-full') continue; // 开关轨道 + 圆钮
          bad.push(`${file} | ${hit}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('V5 门禁:按钮/输入不再回到旧档', () => {
  it('V5 文件里的 button/input/textarea/select 不带 text-xs/text-sm/rounded-md/h-6', () => {
    const bad: string[] = [];
    for (const file of FILES) {
      const text = code(file);
      for (const tag of ['button', 'input', 'textarea', 'select']) {
        for (const expr of classExprs(text, tag)) {
          for (const token of ['text-xs', 'text-sm', 'rounded-md', 'h-6', 'h-9']) {
            if (!expr.includes(token)) continue;
            if (file === 'settings/controls.tsx') continue; // role=switch 的开关是轨道语义,单列例外
            bad.push(`${file} <${tag}> | ${token} | ${expr.slice(0, 90)}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('V5 门禁:浮层容器与遮罩', () => {
  it('每个浮层容器都有 rounded-lg(12)', () => {
    const bad = FLOATS.filter(([file, marker]) => {
      const t = src(file);
      return !t.includes(marker) || !t.includes('rounded-lg');
    });
    expect(bad.map(([f]) => f)).toEqual([]);
  });

  it('每个浮层都有阴影:shadow-lg 或 overlay-scrim(内含 --shadow-lg)', () => {
    const bad = FLOATS.filter(([file]) => {
      const t = src(file);
      return !t.includes('shadow-lg') && !t.includes('overlay-scrim');
    });
    expect(bad.map(([f]) => f)).toEqual([]);
  });

  it('模态浮层都有遮罩:shell 层浮层用 overlay-scrim,对话框用 bg-overlay', () => {
    const bad = SCRIMS.filter(([file, token]) => !src(file).includes(token));
    expect(bad.map(([f]) => f)).toEqual([]);
  });

  it('main.css 定义了两个新基元:overlay-scrim(阴影 + 100vmax overlay)与 tag-guides', () => {
    const css = readFileSync('src/main-window/main.css', 'utf8');
    expect(css).toMatch(/\.overlay-scrim\s*\{[^}]*var\(--shadow-lg\)[^}]*100vmax\s+var\(--color-overlay\)/);
    expect(css).toMatch(/\.tag-guides\s*\{[^}]*repeating-linear-gradient\([^)]*\)[^}]*var\(--tag-guide/);
  });
});

describe('V5 门禁:白底不用 faint(对比度)', () => {
  it('V5 文件里的 text-faint 只出现在 placeholder: 与 disabled: 前缀上', () => {
    const bad: string[] = [];
    for (const file of FILES) {
      for (const expr of allClassExprs(file)) {
        for (const m of expr.matchAll(/([\w:-]*:)?text-faint(?![\w-])/g)) {
          const prefix = m[1] ?? '';
          if (prefix === 'placeholder:' || prefix === 'disabled:' || prefix === 'disabled:hover:') continue;
          bad.push(`${file} | ${m[0]} | ${expr.slice(0, 90)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('侧栏行与设置页的说明文字走 muted(计数导轨 / 行说明)', () => {
    expect(src('sidebar/TagRow.tsx')).toMatch(/COUNT_RAIL_CLASS = '[^']*text-label[^']*text-muted/);
    expect(src('settings/controls.tsx')).toMatch(/text-label text-muted/);
  });
});
