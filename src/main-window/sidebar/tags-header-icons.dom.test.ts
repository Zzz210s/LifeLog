// @vitest-environment jsdom
/**
 * 侧栏标签分区头部:四个图标按钮(2026-10-07 从三个加了一个「标签树里显示关系」)。
 * `aria-label` 与 `title` 是无障碍与验收脚本(CDP 按 aria-label 定位)的定位锚点;
 * 图标只换形态、不改语义。图标风格照仓内既有:viewBox 0 0 16 16 / stroke=currentColor /
 * h-3.5 w-3.5 / aria-hidden。放大镜默认收起(不渲染 input),展开后 Esc 清空并收起。
 * 「筛选标签」图标同期从漏斗换成筛选/条件语义的递减线条,与放大镜一眼区分。
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
let relationCalls: number;

beforeEach(() => {
  modeCalls = [];
  filterCalls = 0;
  searchCalls = 0;
  closeCalls = 0;
  relationCalls = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = async (
  mode: 'tree' | 'flat',
  searchOpen = false,
  showRelations = true
): Promise<void> => {
  await act(async () =>
    root.render(
      createElement(TagsHeader, {
        flash: null,
        mode,
        onModeChange: (m: 'tree' | 'flat') => modeCalls.push(m),
        onFilterTags: () => {
          filterCalls += 1;
        },
        showRelations,
        onToggleRelations: () => {
          relationCalls += 1;
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
  it('分区标题为「实体」(spec §5.3:分区里装的是树内实体,与「条目」同一口径)', async () => {
    await render('tree');
    expect(host.querySelector('h2')?.textContent).toBe('实体');
  });

  it('树模式:四个按钮都是纯图标,aria-label/title 仍是原值', async () => {
    await render('tree');
    const [search, mode, relations, filter] = buttons();
    expect(buttons()).toHaveLength(4);
    expect([
      search.getAttribute('aria-label'),
      mode.getAttribute('aria-label'),
      relations.getAttribute('aria-label'),
      filter.getAttribute('aria-label'),
    ]).toEqual(['搜索标签', '切换为扁平列表', '标签树里显示关系', '筛选标签']);
    expect([
      search.getAttribute('title'),
      mode.getAttribute('title'),
      relations.getAttribute('title'),
      filter.getAttribute('title'),
    ]).toEqual(['搜索标签', '切换为扁平列表', '标签树里显示关系', FILTER_TITLE]);
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

  it('「标签树里显示关系」按当前值 aria-pressed,点击回调一次', async () => {
    await render('tree', false, true);
    const on = buttons()[2];
    expect(on.getAttribute('aria-pressed')).toBe('true');
    expect(String(on.className)).toContain('bg-selected');
    await act(async () => on.click());
    expect(relationCalls).toBe(1);
    await render('tree', false, false);
    const off = buttons()[2];
    expect(off.getAttribute('aria-pressed')).toBe('false');
    expect(String(off.className)).not.toContain('bg-selected');
  });

  it('回归:四个入口仍各自回调', async () => {
    await render('tree');
    const [search, mode, relations, filter] = buttons();
    await act(async () => search.click());
    await act(async () => mode.click());
    await act(async () => relations.click());
    await act(async () => filter.click());
    expect(searchCalls).toBe(1);
    expect(modeCalls).toEqual(['flat']);
    expect(relationCalls).toBe(1);
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
});
