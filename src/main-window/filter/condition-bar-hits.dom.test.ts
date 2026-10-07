// @vitest-environment jsdom
/**
 * 条件栏「命中 N 条」小字(标签关系 spec §5;Task 5 欠账 3):
 * 标签与排除标签 chip 按条件对象原序贴上后端独立计数;没有标签/关系条件时不发请求。
 * mock api:不碰真实库。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTER, type FilterConditions } from '../../shared/filter-conditions';
import { ConditionBar } from './ConditionBar';

const { carriedTagPaths, conditionHitCounts } = vi.hoisted(() => ({
  carriedTagPaths: vi.fn(),
  conditionHitCounts: vi.fn(),
}));
vi.mock('../../shared/api', () => ({ api: { carriedTagPaths, conditionHitCounts } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FULL: FilterConditions = {
  ...EMPTY_FILTER,
  tags: [{ path: '工作', includeChildren: true }],
  excludeTags: [{ path: '临时', includeChildren: false }],
};

let root: Root;
let host: HTMLDivElement;

async function render(conditions: FilterConditions = EMPTY_FILTER): Promise<void> {
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

const chipTexts = (): string[] =>
  [...host.querySelectorAll('[aria-label="已生效的筛选条件"] > span')].map((s) => s.textContent ?? '');

beforeEach(() => {
  carriedTagPaths.mockReset();
  carriedTagPaths.mockResolvedValue([]);
  conditionHitCounts.mockReset();
  conditionHitCounts.mockResolvedValue({ groups: [{ op: 'and', itemHits: [], groupHit: null }] });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('条件栏:标签/关系命中数', () => {
  it('标签与排除标签 chip 显示各自的「命中 N 条」小字,按条件对象原序取值', async () => {
    conditionHitCounts.mockResolvedValue({
      groups: [{ op: 'and', itemHits: [3, 1], groupHit: null }],
    });
    await render(FULL);
    await act(async () => {
      await Promise.resolve();
    });
    const texts = chipTexts();
    expect(texts.some((t) => t.includes('命中 3 条'))).toBe(true);
    expect(texts.some((t) => t.includes('命中 1 条'))).toBe(true);
    expect(conditionHitCounts).toHaveBeenCalledWith(FULL);
  });

  it('没有标签/关系条件时不请求命中数', async () => {
    await render();
    expect(conditionHitCounts).not.toHaveBeenCalled();
  });
});
