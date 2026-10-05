// @vitest-environment jsdom
/**
 * 侧栏标签分区的三个按钮改成图标(精简批次 Task 4 + 拾枝 ① 的放大镜):只有 svg,没有文字节点。
 * `aria-label` 与 `title` 一字不改 —— 无障碍与验收脚本(CDP 按 aria-label 定位)都靠它,
 * 图标只换形态、不改语义。图标风格照仓内既有:viewBox 0 0 16 16 / stroke=currentColor /
 * h-3.5 w-3.5 / aria-hidden。放大镜默认收起(不渲染 input),展开后 Esc 清空并收起。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TagsHeader } from './TagsHeader';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 「筛选标签」的悬浮说明(与图标化前逐字一致) */
const FILTER_TITLE = '筛选标签(在统一输入框里按 # 过滤)';

let host: HTMLDivElement;
let root: Root;
let modeCalls: string[];
let filterCalls: number;
let searchCalls: number;
let closeCalls: number;
let carryCalls: boolean[];

beforeEach(() => {
  modeCalls = [];
  filterCalls = 0;
  searchCalls = 0;
  closeCalls = 0;
  carryCalls = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = async (mode: 'tree' | 'flat', searchOpen = false, showCarry = false): Promise<void> => {
  await act(async () =>
    root.render(
      createElement(TagsHeader, {
        flash: null,
        mode,
        showCarry,
        onShowCarryChange: (v: boolean) => carryCalls.push(v),
        onModeChange: (m: 'tree' | 'flat') => modeCalls.push(m),
        onFilterTags: () => {
          filterCalls += 1;
        },
        searchOpen,
        query: '',
        onQueryChange: () => {},
        onToggleSearch: () => {
          searchCalls += 1;
        },
        onCloseSearch: () => {
          closeCalls += 1;
        },
      })
    )
  );
};

const buttons = (): HTMLButtonElement[] => [...host.querySelectorAll('button')] as HTMLButtonElement[];

describe('侧栏标签分区头部:按钮图标化', () => {
  it('树模式:四个按钮都是纯图标,aria-label/title 仍是原值', async () => {
    await render('tree');
    const [search, mode, filter, carry] = buttons();
    expect(buttons()).toHaveLength(4);
    expect([
      search.getAttribute('aria-label'),
      mode.getAttribute('aria-label'),
      filter.getAttribute('aria-label'),
      carry.getAttribute('aria-label'),
    ]).toEqual(['搜索标签', '切换为扁平列表', '筛选标签', '标签树里显示携带']);
    expect([
      search.getAttribute('title'),
      mode.getAttribute('title'),
      filter.getAttribute('title'),
      carry.getAttribute('title'),
    ]).toEqual(['搜索标签', '切换为扁平列表', FILTER_TITLE, '标签树里显示携带']);
    for (const b of buttons()) {
      expect(b.textContent).toBe('');
      const svg = b.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute('viewBox')).toBe('0 0 16 16');
      expect(svg!.getAttribute('aria-hidden')).toBe('true');
      expect(String(svg!.getAttribute('class'))).toContain('h-3.5');
      expect(svg!.querySelector('path')!.getAttribute('stroke')).toBe('currentColor');
    }
  });

  it('扁平模式:模式按钮换成「切换为树形」,仍只有图标', async () => {
    await render('flat');
    const [, mode] = buttons();
    expect(mode.getAttribute('aria-label')).toBe('切换为树形');
    expect(mode.textContent).toBe('');
    expect(mode.querySelector('svg')).not.toBeNull();
  });

  it('回归:三个入口仍各自回调', async () => {
    await render('tree');
    const [search, mode, filter] = buttons();
    await act(async () => search.click());
    await act(async () => mode.click());
    await act(async () => filter.click());
    expect(searchCalls).toBe(1);
    expect(modeCalls).toEqual(['flat']);
    expect(filterCalls).toBe(1);
  });

  it('放大镜默认收起:不渲染 input;展开后 Esc 走 onCloseSearch', async () => {
    await render('tree');
    expect(host.querySelector('input')).toBeNull();
    await render('tree', true);
    const input = host.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('按名称收窄标签树');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(closeCalls).toBe(1);
  });

  it('携带开关:默认关(aria-pressed=false),点击反转传值,开启时有选中态', async () => {
    await render('tree');
    const carry = buttons()[3];
    expect(carry.getAttribute('aria-pressed')).toBe('false');
    await act(async () => carry.click());
    expect(carryCalls).toEqual([true]);

    await render('tree', false, true);
    const on = buttons()[3];
    expect(on.getAttribute('aria-pressed')).toBe('true');
    expect(String(on.getAttribute('class'))).toContain('bg-selected');
    await act(async () => on.click());
    expect(carryCalls).toEqual([true, false]);
  });
});
