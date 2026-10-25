// @vitest-environment node
/**
 * 视觉刷新 V5「侧栏行 / 浮层 / 对话框 / 设置页」的门禁式源码扫描(不渲染,只读 className 文本)。
 *
 * V4 的门禁把 palette/、filter/ExprDialog、TagPickDialog、AddConditionMenu、sidebar/TagMenu*、
 * TagRow、settings/controls 这些文件全部标成「归 V5」跳过;本文件就是那份欠账的收口:
 * - 字号:只允许 7 档令牌(text-display/title/body/body-sm/ui/label/micro),禁 text-xs/sm/base/lg/[Npx]
 * - 圆角:只允许 rounded-xs/sm/md/lg(+ 开关的 rounded-full,单列例外)
 * - 按钮/输入:不再出现 h-6 这类旧档与 rounded-md
 * - 浮层:容器 rounded-lg + shadow-lg;模态层必须有 bg-overlay 遮罩
 * - 对比度:白底不用 text-faint,只有 placeholder: 与 disabled: 两处豁免
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FILES, FLOATS, OFF_SCALE_TYPE, SCRIMS, allClassExprs, classExprs, code, src,
} from './__fixtures__/v5-visual-tokens-scan';

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

  it('每个浮层都有阴影:shadow-lg', () => {
    const bad = FLOATS.filter(([file]) => !src(file).includes('shadow-lg'));
    expect(bad.map(([f]) => f)).toEqual([]);
  });

  it('模态浮层都有遮罩:对话框用 bg-overlay', () => {
    const bad = SCRIMS.filter(([file, token]) => !src(file).includes(token));
    expect(bad.map(([f]) => f)).toEqual([]);
  });

  it('main.css 定义了标签树导轨基元 tag-guides', () => {
    const css = readFileSync('src/main-window/main.css', 'utf8');
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
