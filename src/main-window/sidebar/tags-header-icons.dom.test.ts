// @vitest-environment jsdom
/**
 * 侧栏标签分区的两个按钮改成图标(精简批次 Task 4,R3):只有 svg,没有文字节点。
 * `aria-label` 与 `title` 一字不改 —— 无障碍与验收脚本(CDP 按 aria-label 定位)都靠它,
 * 图标只换形态、不改语义。图标风格照仓内既有:viewBox 0 0 16 16 / stroke=currentColor /
 * h-3.5 w-3.5 / aria-hidden。
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

beforeEach(() => {
  modeCalls = [];
  filterCalls = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = async (mode: 'tree' | 'flat'): Promise<void> => {
  await act(async () =>
    root.render(
      createElement(TagsHeader, {
        flash: null,
        mode,
        onModeChange: (m: 'tree' | 'flat') => modeCalls.push(m),
        onFilterTags: () => {
          filterCalls += 1;
        },
      })
    )
  );
};

const buttons = (): HTMLButtonElement[] => [...host.querySelectorAll('button')] as HTMLButtonElement[];

describe('侧栏标签分区头部:按钮图标化', () => {
  it('树模式:两个按钮都是纯图标,aria-label/title 仍是原值', async () => {
    await render('tree');
    const [mode, filter] = buttons();
    expect(buttons()).toHaveLength(2);
    expect([mode.getAttribute('aria-label'), filter.getAttribute('aria-label')]).toEqual([
      '切换为扁平列表',
      '筛选标签',
    ]);
    expect([mode.getAttribute('title'), filter.getAttribute('title')]).toEqual(['切换为扁平列表', FILTER_TITLE]);
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
    const [mode] = buttons();
    expect(mode.getAttribute('aria-label')).toBe('切换为树形');
    expect(mode.textContent).toBe('');
    expect(mode.querySelector('svg')).not.toBeNull();
  });

  it('回归:两个入口仍各自回调', async () => {
    await render('tree');
    const [mode, filter] = buttons();
    await act(async () => mode.click());
    await act(async () => filter.click());
    expect(modeCalls).toEqual(['flat']);
    expect(filterCalls).toBe(1);
  });
});
