// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UnifiedDropdown } from './UnifiedDropdown';

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; });

const mount = async (props: Parameters<typeof UnifiedDropdown>[0]) => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(UnifiedDropdown, props)));
  return host;
};

describe('统一输入框的下拉(复用浮层列表)', () => {
  it('渲染 listbox 与行,选中行带 aria-selected', async () => {
    const host = await mount({
      rows: [{ id: '工作/项目A', label: '工作/项目A', ranges: [] }, { id: '工作/项目B', label: '工作/项目B', ranges: [] }] as never,
      activeIndex: 1, total: 2, truncated: false, onHover: () => {}, onAccept: () => {},
    });
    expect(host.querySelector('[role="listbox"]')).not.toBeNull();
    expect(host.querySelectorAll('li[role="option"]').length).toBe(2);
    expect(host.querySelectorAll('li[aria-selected="true"]').length).toBe(1);
  });

  it('点行 = 采纳', async () => {
    const onAccept = vi.fn();
    const host = await mount({
      rows: [{ id: 'a', label: 'a', ranges: [] }] as never,
      activeIndex: 0, total: 1, truncated: false, onHover: () => {}, onAccept,
    });
    await act(async () => (host.querySelector('li[role="option"]') as HTMLElement).click());
    expect(onAccept).toHaveBeenCalledWith(0);
  });

  it('截断时给一行提示', async () => {
    const host = await mount({ rows: [] as never, activeIndex: 0, total: 200, truncated: true, onHover: () => {}, onAccept: () => {} });
    expect(host.textContent).toContain('还有更多');
  });

  it('无匹配时给空态文案,且不渲染行', async () => {
    const host = await mount({ rows: [] as never, activeIndex: 0, total: 0, truncated: false, onHover: () => {}, onAccept: () => {} });
    expect(host.textContent).toContain('无匹配结果');
    expect(host.querySelectorAll('li[role="option"]').length).toBe(0);
  });

  it('悬停与命中高亮:悬停回调给索引,label 命中段包 <mark>', async () => {
    const onHover = vi.fn();
    const host = await mount({
      rows: [{ id: 'b', label: '买牛奶', ranges: [{ start: 0, end: 1 }] }] as never,
      activeIndex: 0, total: 1, truncated: false, onHover, onAccept: () => {},
    });
    // React 的 onMouseEnter 由 mouseover 委托触发(native mouseenter 不冒泡)
    await act(async () => (host.querySelector('li[role="option"]') as HTMLElement).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(onHover).toHaveBeenCalledWith(0);
    expect(host.querySelector('mark')?.textContent).toBe('买');
  });
});
