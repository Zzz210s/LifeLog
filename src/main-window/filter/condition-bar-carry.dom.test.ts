// @vitest-environment jsdom
/**
 * 条件栏摘要的 `+携带` 门控接线:数据源 `api.carriedTagPaths()` 一次批量取,
 * 真有携带者才显示;取不到(拒绝)时退回「都显示」。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterConditions } from '../../shared/filter-conditions';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import { ConditionBar } from './ConditionBar';

const { carriedTagPaths } = vi.hoisted(() => ({ carriedTagPaths: vi.fn() }));
vi.mock('../../shared/api', () => ({ api: { carriedTagPaths } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COND: FilterConditions = {
  ...EMPTY_FILTER,
  tags: [
    { path: '工作', includeChildren: true },
    { path: '临时', includeChildren: false },
  ],
  expr: '#工作 AND #临时',
};

let root: Root;
let host: HTMLDivElement;

async function render(conditions: FilterConditions): Promise<void> {
  await act(async () => {
    root.render(
      createElement(ConditionBar, {
        conditions,
        onPatch: () => {},
        addConditionOpen: false,
        onAddConditionOpenChange: () => {},
      })
    );
  });
}

const summaryText = (): string =>
  host.querySelector('[data-testid="condition-bar-summary"]')?.textContent ?? '';

beforeEach(() => {
  carriedTagPaths.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('条件栏摘要 +携带:按携带者数据门控', () => {
  it('有携带者才显示(标签组与表达式叶子同一集合),且只查一次', async () => {
    carriedTagPaths.mockResolvedValue(['工作']);
    await render(COND);
    expect(summaryText()).toBe('标签 工作+携带、临时;表达式:#工作+携带 AND #临时');
    expect(carriedTagPaths).toHaveBeenCalledTimes(1);
  });

  it('没有任何携带者时全部不显示', async () => {
    carriedTagPaths.mockResolvedValue([]);
    await render(COND);
    expect(summaryText()).toBe('标签 工作、临时;表达式:#工作 AND #临时');
  });

  it('数据取不到(IPC 拒绝)时退回现在的行为:都显示', async () => {
    carriedTagPaths.mockRejectedValue(new Error('no ipc'));
    await render(COND);
    expect(summaryText()).toBe('标签 工作+携带、临时+携带;表达式:#工作+携带 AND #临时+携带');
  });

  it('加载中(IPC 未回)先不标 +携带:真实库 0 条携带行时也不闪一下', async () => {
    let resolveFetch: (v: string[]) => void = () => {};
    carriedTagPaths.mockReturnValue(new Promise<string[]>((r) => { resolveFetch = r; }));
    await render(COND);
    expect(summaryText()).not.toContain('携带');
    await act(async () => resolveFetch(['工作']));
    expect(summaryText()).toBe('标签 工作+携带、临时;表达式:#工作+携带 AND #临时');
  });
});
