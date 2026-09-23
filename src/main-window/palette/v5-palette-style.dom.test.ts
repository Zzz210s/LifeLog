// @vitest-environment jsdom
/**
 * 视觉刷新 V5 的浮层(命令面板 / 快速打开)证据(设计 §4-9):
 * 容器 rounded-lg(12)+ shadow-lg + 遮罩(overlay-scrim,纯 CSS 不新增 DOM 节点),
 * 行高落在 28–32(13/18 + py-1.5 的 6+6 = 30),命中高亮 = accent-soft 底 + accent-text 字,
 * 副文本/计数/徽标一律走 --text-label 且不用白底不达标的 faint。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { highlightLabel } from './PaletteRow';
import { paletteHarness, type PaletteHarness } from './palette-harness';

const tokens = (el: Element): string[] => String(el.className).split(/\s+/).filter(Boolean);

let h: PaletteHarness;

beforeEach(() => {
  h = paletteHarness({ decorations: { 'settings.open': { detail: 'Ctrl+,', checked: true } } });
});

afterEach(() => {
  h.unmount();
});

const root = (): HTMLElement => h.host.querySelector('[data-floating="palette"]') as HTMLElement;
const rows = (): HTMLElement[] => [...h.host.querySelectorAll('li[role="option"]')] as HTMLElement[];

describe('V5 浮层容器:radius-lg + shadow-lg + 遮罩', () => {
  it('根节点用 rounded-lg 与 overlay-scrim(取代 shadow-xl),仍是 fixed 覆盖层', () => {
    const t = tokens(root());
    expect(t).toContain('rounded-lg');
    expect(t).toContain('overlay-scrim');
    expect(t).toContain('border');
    expect(t).toContain('fixed');
    expect(t).not.toContain('shadow-xl');
  });

  it('遮罩由 main.css 的 overlay-scrim 给出(浮层 shadow-lg + 外围 100vmax overlay)', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/main-window/main.css', 'utf8');
    expect(css).toMatch(/\.overlay-scrim\s*\{[^}]*box-shadow:\s*var\(--shadow-lg\)[^}]*100vmax\s+var\(--color-overlay\)/);
  });

  it('前缀徽标 = 小控件口径(rounded-xs / text-label),不再是 text-xs + 裸 rounded', () => {
    const badge = root().querySelector('span') as HTMLElement;
    const t = tokens(badge);
    expect(t).toContain('rounded-xs');
    expect(t).toContain('text-label');
    expect(t).toContain('text-accent-text');
    expect(t).not.toContain('text-xs');
  });
});

describe('V5 浮层行:高 28–32 + 命中高亮', () => {
  it('输入框 32 高 / text-ui(不再 h-7 + text-sm)', () => {
    const t = tokens(h.input());
    expect(t).toContain('h-8');
    expect(t).toContain('text-ui');
    expect(t).not.toContain('text-sm');
    expect(t).not.toContain('h-7');
  });

  it('行 = text-ui + py-1.5(高 30),间距 gap-2 与 px-3 都在刻度上', () => {
    h.open('>');
    const items = rows();
    expect(items.length).toBeGreaterThan(0);
    const t = tokens(items[0]);
    for (const token of ['text-ui', 'py-1.5', 'gap-2', 'px-3']) expect(t).toContain(token);
    expect(t).not.toContain('text-sm');
  });

  it('命中行 = accent-soft 底 + accent-text 字;非命中行只有 hover 底色', () => {
    h.open('>');
    const items = rows();
    const active = items.find((el) => el.getAttribute('aria-selected') === 'true') as HTMLElement;
    const idle = items.find((el) => el.getAttribute('aria-selected') === 'false') as HTMLElement;
    expect(tokens(active)).toContain('bg-accent-soft');
    expect(tokens(active)).toContain('text-accent-text');
    expect(tokens(idle)).not.toContain('bg-accent-soft');
    expect(tokens(idle)).toContain('hover:bg-hover');
  });

  it('命中段 <mark> 用 accent-soft + accent-text + rounded-xs', () => {
    const parts = highlightLabel('买牛奶', [{ start: 1, end: 2 }]);
    const mark = parts[1] as { props: { className: string } };
    expect(String(mark.props.className)).toBe('rounded-xs bg-accent-soft text-accent-text');
  });

  it('副文本与勾选态走 --text-label;副文本不再用 faint', () => {
    h.open('>');
    const detail = [...h.host.querySelectorAll('li span')].find((s) => s.textContent === 'Ctrl+,') as HTMLElement;
    const checked = [...h.host.querySelectorAll('li span')].find((s) => s.textContent === '已勾选') as HTMLElement;
    expect(tokens(detail)).toContain('text-label');
    expect(tokens(detail)).toContain('tabular-nums');
    expect(tokens(detail)).not.toContain('text-faint');
    expect(tokens(checked)).toContain('text-label');
    expect(tokens(checked)).toContain('text-accent-text');
  });

  it('空态标题与提示都在刻度内(text-ui / text-label + muted)', () => {
    h.open('>');
    h.type('zzz-不存在-zzz');
    const empty = [...h.host.querySelectorAll('li[role="option"] p')] as HTMLElement[];
    expect(empty.length).toBe(2);
    expect(tokens(empty[0])).toContain('text-ui');
    expect(tokens(empty[1])).toContain('text-label');
    expect(empty[0].textContent).toContain('无匹配结果');
  });
});

describe('V5 浮层回归:键盘与开关行为不变', () => {
  it('Ctrl+Shift+P 打开的后缀前缀、Enter 接受、Esc 关闭都照旧', () => {
    h.open('>');
    expect(h.controller().isOpen).toBe(true);
    expect(h.controller().prefix).toBe('>');
    h.press('Escape');
    expect(h.controller().isOpen).toBe(false);

    h.open('');
    h.press('Enter');
    expect(h.accepted[0]?.id).toBe('note.new');
  });
});
