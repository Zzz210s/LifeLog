// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { GraphFilterPanel } from './GraphFilterPanel';
import { MAX_DEPTH_LIMIT, type GraphFilters } from './graph-filters';

const base: GraphFilters = { axes: ['地点'], maxDepth: MAX_DEPTH_LIMIT, onlyWithNotes: false, minNotes: 0 };
const roots = ['地点', '时间', '空标签'];

async function mount(filters: GraphFilters, onChange = vi.fn(), onReset = vi.fn()) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(GraphFilterPanel, { filters, roots, onChange, onReset }));
  });
  return { host, onChange, onReset };
}

describe('GraphFilterPanel:四项过滤器都受控', () => {
  it('勾选/取消某轴 -> onChange 收到正确的 axes', async () => {
    const { host, onChange } = await mount(base);
    const boxes = [...host.querySelectorAll('input[type="checkbox"]')];
    await act(async () => { (boxes[0] as HTMLInputElement).click(); }); // 取消 地点
    expect(onChange.mock.calls[0][0].axes).toEqual([]);
    onChange.mockClear();
    await act(async () => { (boxes[1] as HTMLInputElement).click(); }); // 勾上 时间
    expect(onChange.mock.calls[0][0].axes).toEqual(['地点', '时间']);
  });

  it('深度上限与最少条目数是数字,只显示有条目是布尔', async () => {
    const { host, onChange } = await mount(base);
    const selects = [...host.querySelectorAll('select')];
    await act(async () => {
      selects[0].value = '3';
      selects[0].dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange.mock.calls[0][0].maxDepth).toBe(3);
    onChange.mockClear();
    await act(async () => {
      selects[1].value = '5';
      selects[1].dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange.mock.calls[0][0].minNotes).toBe(5);
    onChange.mockClear();
    const only = host.querySelector('input[aria-label="只显示有条目的实体"]') as HTMLInputElement;
    await act(async () => { only.click(); });
    expect(onChange.mock.calls[0][0].onlyWithNotes).toBe(true);
  });

  it('点「重置过滤器」-> onReset', async () => {
    const { host, onReset } = await mount(base);
    await act(async () => {
      [...host.querySelectorAll('button')].find((b) => b.textContent!.includes('重置过滤器'))!.click();
    });
    expect(onReset).toHaveBeenCalled();
  });

  it('轴列表把全部根都列出来', async () => {
    const { host } = await mount(base);
    const labels = [...host.querySelectorAll('label span')].map((s) => s.textContent);
    for (const r of roots) expect(labels).toContain(r);
  });
});
