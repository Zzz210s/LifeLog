// @vitest-environment jsdom
/**
 * 视觉刷新 V3「标签页栏 VS Code 语义」的组件证据(jsdom,只看类名,不引入计算样式):
 * 活动页 = bg-canvas + 顶部 2px accent(border-t-2 + border-accent);非活动页 = bg-chrome-alt;
 * 条与页同高 32(h-8),页角 6/6/0/0(rounded-t-sm);单页时的长占位提示已删除;
 * 点击切换 / × 关闭 / 双击改名 / 拖拽重排的行为不变(回归)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import { TabsBar } from './TabsBar';
import type { Tab } from './tabs-model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TABS: Tab[] = [
  { title: '', conditions: { ...EMPTY_FILTER } },
  { title: '工作', conditions: { ...EMPTY_FILTER, keyword: '工作' } },
];

let root: Root;
let host: HTMLDivElement;
let calls: { activate: number[]; close: number[]; move: Array<[number, number]>; rename: Array<[number, string]> };

async function render(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(TabsBar, {
        tabs: TABS,
        activeIndex: 0,
        onActivate: (i: number) => calls.activate.push(i),
        onClose: (i: number) => calls.close.push(i),
        onMove: (from: number, to: number) => calls.move.push([from, to]),
        onRename: (i: number, title: string) => calls.rename.push([i, title]),
        onPreset: () => {},
        onAddCurrent: () => {},
      })
    );
  });
}

const tokens = (el: Element): string[] => el.className.split(/\s+/).filter(Boolean);
const tabs = (): HTMLElement[] => [...host.querySelectorAll('[role="tab"]')] as HTMLElement[];
const bar = (): HTMLElement => host.querySelector('[role="tablist"]') as HTMLElement;

beforeEach(() => {
  calls = { activate: [], close: [], move: [], rename: [] };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('V3 标签页:表面成对 + 高 32 + 顶部 accent 指示', () => {
  it('条高 32(h-8)、chrome 底;单页时的长占位提示已删除', async () => {
    await render();
    const t = tokens(bar());
    for (const token of ['h-8', 'bg-chrome', 'border-b', 'border-border']) expect(t).toContain(token);
    expect(host.textContent).not.toContain('还没有额外标签页');
    // 入口提示改由「+」按钮的 title 承担
    expect(host.querySelector('button[title="新建标签页(预设或当前筛选)"]')).toBeTruthy();
  });

  it('活动页 = bg-canvas + border-accent + 顶部 2px 指示;非活动页 = bg-chrome-alt', async () => {
    await render();
    expect(tabs().length).toBe(2);
    const [active, idle] = tabs();
    expect(active.getAttribute('aria-selected')).toBe('true');
    const a = tokens(active);
    for (const token of ['h-8', 'rounded-t-sm', 'border-t-2', 'border-accent', 'bg-canvas', 'text-text', 'text-ui']) {
      expect(a).toContain(token);
    }
    const i = tokens(idle);
    for (const token of ['h-8', 'rounded-t-sm', 'border-t-2', 'border-transparent', 'bg-chrome-alt', 'text-muted']) {
      expect(i).toContain(token);
    }
    // 两态底色成对可区分:活动 canvas / 非活动 chrome-alt,且互不串味
    expect(a).not.toContain('bg-chrome-alt');
    expect(i).not.toContain('bg-canvas');
    expect(i).not.toContain('border-accent');
    // 页角档位唯一:只允许 rounded-t-sm(6/6/0/0)
    for (const el of tabs()) {
      expect(tokens(el)).not.toContain('rounded-t-md');
      expect(tokens(el)).not.toContain('rounded-t-xs');
    }
  });

  it('双击改名:行内输入框同为 h-8 / rounded-t-sm / text-ui', async () => {
    await render();
    await act(async () => {
      tabs()[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const input = host.querySelector('input[aria-label="标签页标题"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const t = tokens(input);
    for (const token of ['h-8', 'rounded-t-sm', 'text-ui', 'border-accent']) expect(t).toContain(token);
  });
});

describe('V3 标签页回归:切换 / 关闭 / 拖拽 / 改名入口不变', () => {
  it('点击非活动页触发切换;点 × 只触发关闭(不冒泡成切换)', async () => {
    await render();
    await act(async () => tabs()[1].dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(calls.activate).toEqual([1]);
    const close = host.querySelector('[aria-label="关闭标签页 工作"]') as HTMLButtonElement;
    await act(async () => close.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(calls.close).toEqual([1]);
    expect(calls.activate).toEqual([1]);
  });

  it('拖拽重排:第一页拖到第二页落点,onMove(0, 1)', async () => {
    await render();
    const dt = { effectAllowed: '', setData: () => {} };
    const drag = (el: HTMLElement, type: string) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: dt });
      el.dispatchEvent(ev);
    };
    // dragstart 与 drop 分两次 act:拖拽源要先重渲染进 state,drop 处理函数才看得到它
    await act(async () => drag(tabs()[0], 'dragstart'));
    await act(async () => drag(tabs()[1], 'drop'));
    expect(calls.move).toEqual([[0, 1]]);
  });

  it('改名提交仍走上层 onRename(双击 -> 改值 -> Enter)', async () => {
    await render();
    await act(async () => {
      tabs()[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const input = host.querySelector('input[aria-label="标签页标题"]') as HTMLInputElement;
    input.value = '新名字';
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(calls.rename).toEqual([[0, '新名字']]);
  });
});
