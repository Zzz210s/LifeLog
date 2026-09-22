// @vitest-environment node
/**
 * 视觉刷新 V4「按钮 / 输入框统一」的门禁式源码扫描(不渲染,只读 className 文本):
 * - 操作按钮:高度只允许 28(h-7)或 32(h-8)两档,圆角只允许 rounded-sm(6px),字号只允许 --text-ui
 * - 文本控件:h-8 + rounded-sm + border-border-strong + text-ui
 * - main.css 里指定「由 V4 统一移除」的 focus:border-accent 在主窗组件内不再出现
 *
 * SKIP_* 里逐条写明「归谁」:标签页/chip 归 V3,浮层/对话框/侧栏行/设置行归 V5,
 * 开关(role=switch)、键盘专用的 sr-only 按钮与正文源码框不是「操作按钮」语义。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = 'src/main-window';

/** 按钮扫描跳过的文件/目录(前缀匹配) */
const SKIP_BUTTONS: Array<[string, string]> = [
  ['palette/', '命令面板浮层:归 V5(另有 quickpick 设计口径)'],
  ['filter/ExprDialog.tsx', '对话框:归 V5'],
  ['filter/ExprSyntaxHint.tsx', '对话框内语法提示:归 V5'],
  ['filter/TagPickDialog.tsx', '对话框:归 V5'],
  ['filter/AddConditionMenu.tsx', '下拉浮层菜单项:归 V5'],
  ['filter/FilterChips.tsx', '条件 chip 与其单删 ×:归 V3'],
  ['stream/NoteChips.tsx', '笔记 chip 与 +N 展开:归 V3'],
  ['tabs/TabItem.tsx', '标签页与其关闭 ×:归 V3'],
  ['tabs/TabAddMenu.tsx', '标签页「+」:归 V3'],
  ['sidebar/TagMenu', '标签右键菜单(对话框):归 V5'],
  ['sidebar/TagRow.tsx', '标签树行(列表行,高 24→V5 定 26):归 V5'],
  ['settings/controls.tsx', '开关 role=switch、百分比/下拉由输入框扫描覆盖'],
];

/** 输入框扫描跳过的文件(前缀匹配) */
const SKIP_INPUTS: Array<[string, string]> = [
  ['palette/', '命令面板浮层(无边框下划线输入):归 V5'],
  ['filter/ExprDialog.tsx', '对话框:归 V5'],
  ['filter/TagPickDialog.tsx', '对话框:归 V5'],
  ['sidebar/TagMenu', '对话框:归 V5'],
  ['editor/EditPanel.tsx', '正文源码框:任务明确例外,保持正文编辑口径'],
  ['settings/AppearanceSection.tsx', '主题三选一是原生 radio,不按文本输入改'],
  ['tabs/TabItem.tsx', '标签页改名框(顶角 6/6/0/0):归 V3'],
];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx$/.test(p) && !/\.test\./.test(p) && !/harness/.test(p) ? [p] : [];
  });

const rel = (p: string): string => relative(ROOT, p).split(sep).join('/');
const pick = (skip: Array<[string, string]>): string[] =>
  walk(ROOT).filter((p) => !skip.some(([prefix]) => rel(p).startsWith(prefix)));

/** 文件内的 `const NAME = …;` 文本(用于把 className 里引用的类名常量还原成字面量) */
const constText = (src: string, name: string): string => {
  const i = src.indexOf(`const ${name} =`);
  if (i < 0) return '';
  const j = src.indexOf(';', i);
  return src.slice(i, j < 0 ? i + 400 : j);
};

/** 取出某个标签(button/input/textarea/select)所有 className 表达式,并把引用的局部常量还原 */
function classExprs(src: string, tag: string): string[] {
  const out: string[] = [];
  let i = src.indexOf(`<${tag}`);
  while (i >= 0) {
    const seg = src.slice(i, i + 900);
    const m = /className=(?:\{([\s\S]{0,400}?)\}|"([^"]*)")/.exec(seg);
    if (m) {
      const expr = (m[1] ?? m[2]).replace(/\s+/g, ' ').trim();
      const consts = [...expr.matchAll(/[A-Z][A-Z0-9_]{2,}/g)].map((c) => constText(src, c[0]));
      out.push([expr, ...consts].join(' '));
    }
    i = src.indexOf(`<${tag}`, i + tag.length + 1);
  }
  return out;
}

const BAD_BUTTON = ['rounded-md', 'rounded-xs', 'rounded-full', 'rounded ', 'text-xs', 'text-sm', 'h-6', 'h-9'];

describe('V4 按钮三型门禁:高度只有 28 / 32', () => {
  it(`除已声明的例外外,主窗每个操作按钮都是 h-7/h-8 且不带旧档圆角与字号(${pick(SKIP_BUTTONS).length} 文件)`, () => {
    const bad: string[] = [];
    for (const file of pick(SKIP_BUTTONS)) {
      const src = readFileSync(file, 'utf8');
      for (const expr of classExprs(src, 'button')) {
        if (expr.includes('sr-only')) continue; // 键盘专用按钮:1px 占位,视觉上不出现
        for (const token of BAD_BUTTON) if (expr.includes(token)) bad.push(`${rel(file)} | ${token} | ${expr}`);
        if (!/BTN_|h-7|h-8/.test(expr)) bad.push(`${rel(file)} | 缺高度档 | ${expr}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('V4 输入框门禁:32 高 + 6 圆角 + 强边 + --text-ui', () => {
  it('主窗文本控件不再用 rounded-md / text-xs / text-sm / focus:border-accent', () => {
    const bad: string[] = [];
    for (const file of pick(SKIP_INPUTS)) {
      const src = readFileSync(file, 'utf8');
      for (const tag of ['input', 'textarea', 'select']) {
        for (const expr of classExprs(src, tag)) {
          for (const token of ['rounded-md', 'rounded-lg', 'text-xs', 'text-sm', 'focus:border-accent']) {
            if (expr.includes(token)) bad.push(`${rel(file)} <${tag}> | ${token} | ${expr}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('输入框的主色边必须是 border-border-strong(不接受裸 border-border)', () => {
    const bad: string[] = [];
    for (const file of pick(SKIP_INPUTS)) {
      const src = readFileSync(file, 'utf8');
      for (const tag of ['input', 'textarea', 'select']) {
        for (const expr of classExprs(src, tag)) {
          if (/\bborder-border(?![\w-])/.test(expr)) bad.push(`${rel(file)} <${tag}> | ${expr}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('V4 焦点口径:组件不再自带 focus:border-accent', () => {
  it('main.css 注释指定的「V4 统一移除」已落地(全主窗 0 处)', () => {
    const hits = walk(ROOT).filter((p) => readFileSync(p, 'utf8').includes('focus:border-accent'));
    expect(hits.map(rel)).toEqual([]);
  });
});
