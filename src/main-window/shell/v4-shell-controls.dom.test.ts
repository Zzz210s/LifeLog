// @vitest-environment jsdom
/**
 * 视觉刷新 V4 的组件证据(外壳三件:顶栏、错误条、侧栏标签分区头部):
 * 顶栏 44(h-11);图标按钮 28×28、次按钮 32、圆角一律 6(rounded-sm)、字号一律 --text-ui;
 * 交互与无障碍名不改(点开关/齿轮/返回/重试/关闭/过滤都仍回调)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ErrorBar } from './ErrorBar';
import { TopBar } from './TopBar';
import { TagsHeader } from '../sidebar/TagsHeader';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

async function render(el: ReturnType<typeof createElement>): Promise<void> {
  await act(async () => {
    root.render(el);
  });
}

const tokens = (el: Element): string[] => el.className.split(/\s+/).filter(Boolean);
const byLabel = (label: string): HTMLElement => {
  const el = host.querySelector(`[aria-label="${label}"]`);
  if (!el) throw new Error('未渲染出 ' + label);
  return el as HTMLElement;
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const topBar = (over: Partial<Parameters<typeof TopBar>[0]> = {}) =>
  createElement(TopBar, {
    view: 'stream',
    sidebarVisible: true,
    menuItems: [],
    exporting: false,
    exported: false,
    onToggleSidebar: () => {},
    onOpenSettings: () => {},
    onBack: () => {},
    ...over,
  });

describe('V4 顶栏:44 高 + 图标/次按钮两档', () => {
  it('顶栏 h-11(44),不再是 h-12', async () => {
    await render(topBar());
    const header = host.querySelector('header') as HTMLElement;
    expect(tokens(header)).toContain('h-11');
    expect(tokens(header)).not.toContain('h-12');
  });

  it('侧栏开关与设置入口 = 图标档(28×28 / rounded-sm),不再 rounded-md', async () => {
    await render(topBar());
    for (const label of ['隐藏侧栏', '设置']) {
      const btn = byLabel(label);
      for (const token of ['h-7', 'w-7', 'rounded-sm', 'text-muted', 'hover:bg-hover', 'items-center']) {
        expect(tokens(btn), label).toContain(token);
      }
      expect(tokens(btn), label).not.toContain('rounded-md');
    }
    // aria 语义不变:开关仍带 aria-pressed 表达侧栏状态
    expect(byLabel('隐藏侧栏').getAttribute('aria-pressed')).toBe('true');
  });

  it('设置页顶栏右侧是次按钮档(32 / rounded-sm / text-ui),文案不变', async () => {
    await render(topBar({ view: 'settings' }));
    const back = [...host.querySelectorAll('button')].find((b) => b.textContent === '返回信息流') as HTMLElement;
    for (const token of ['h-8', 'rounded-sm', 'text-ui', 'border']) expect(tokens(back)).toContain(token);
    expect(tokens(back)).not.toContain('rounded-md');
    expect(tokens(back)).not.toContain('text-xs');
  });

  it('回归:三个入口仍各自回调', async () => {
    const calls: string[] = [];
    await render(
      topBar({
        onToggleSidebar: () => calls.push('toggle'),
        onOpenSettings: () => calls.push('settings'),
      })
    );
    await act(async () => byLabel('隐藏侧栏').click());
    await act(async () => byLabel('设置').click());
    expect(calls).toEqual(['toggle', 'settings']);
  });
});

describe('V4 错误条:文字动作按钮走 28 档', () => {
  it('重试与关闭都是 h-7 / rounded-sm / text-ui(不再是裸 text-xs)', async () => {
    await render(
      createElement(ErrorBar, {
        error: { kind: 'query', message: '查询失败' },
        onRetry: () => {},
        onDismiss: () => {},
      })
    );
    const buttons = [...host.querySelectorAll('button')] as HTMLElement[];
    expect(buttons).toHaveLength(2);
    for (const btn of buttons) {
      for (const token of ['h-7', 'rounded-sm', 'text-ui', 'text-danger']) expect(tokens(btn)).toContain(token);
      expect(tokens(btn)).not.toContain('text-xs');
    }
  });

  it('回归:重试/关闭仍回调,非查询错误不给重试入口', async () => {
    const calls: string[] = [];
    await render(
      createElement(ErrorBar, {
        error: { kind: 'action', message: '删除失败' },
        onRetry: () => calls.push('retry'),
        onDismiss: () => calls.push('dismiss'),
      })
    );
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['关闭']);
    await act(async () => (host.querySelector('button') as HTMLElement).click());
    expect(calls).toEqual(['dismiss']);
  });
});

describe('V4 标签分区头部:动作按钮 28 档 + 过滤框 32 档', () => {
  const header = (over: Record<string, unknown> = {}) =>
    createElement(TagsHeader, {
      flash: null,
      mode: 'tree',
      onModeChange: () => {},
      filterOpen: false,
      onToggleFilter: () => {},
      query: '',
      onQueryChange: () => {},
      ...over,
    });

  it('树/扁平与过滤按钮都是 h-7 / rounded-sm / text-ui', async () => {
    await render(header());
    const buttons = [...host.querySelectorAll('button')] as HTMLElement[];
    expect(buttons.map((b) => b.textContent)).toEqual(['树', '过滤']);
    for (const btn of buttons) {
      for (const token of ['h-7', 'rounded-sm', 'text-ui']) expect(tokens(btn)).toContain(token);
      expect(tokens(btn)).not.toContain('text-xs');
    }
  });

  it('过滤框 h-8 / rounded-sm / border-border-strong / text-ui', async () => {
    await render(header({ filterOpen: true }));
    const input = host.querySelector('input') as HTMLElement;
    for (const token of ['h-8', 'rounded-sm', 'border-border-strong', 'text-ui']) {
      expect(tokens(input)).toContain(token);
    }
    expect(tokens(input)).not.toContain('rounded');
    expect(tokens(input)).not.toContain('text-xs');
  });

  it('回归:模式切换与过滤回调不变', async () => {
    const calls: string[] = [];
    await render(header({ onModeChange: (m: string) => calls.push('mode:' + m), onToggleFilter: () => calls.push('filter') }));
    const [mode, filter] = [...host.querySelectorAll('button')] as HTMLElement[];
    await act(async () => mode.click());
    await act(async () => filter.click());
    expect(calls).toEqual(['mode:flat', 'filter']);
  });
});
