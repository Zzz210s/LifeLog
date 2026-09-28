// @vitest-environment jsdom
/**
 * 标签选择对话框的**显示口径**(tag-label-md T6):候选行显示纯文本形态
 * (`[郴](chēn)州市` -> `郴州市`),但回传的路径仍是原始形态(写入与筛选都用路径)。
 * 视觉口径在 v5-dialog-style.dom.test.ts(那份已到 199 行,故本用例独立成文件)。
 */
import { act, createElement } from 'react';

/** 让元素看起来"被 CSS 截断"(jsdom 里 scrollWidth/clientWidth 恒 0):随后触发 React 的 onMouseEnter */
function markTruncated(el: HTMLElement): void {
  Object.defineProperty(el, 'scrollWidth', { value: 999, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: 100, configurable: true });
}

/** 未截断时不挂 title;截断后悬浮才给完整文本 */
function expectHoverTitle(el: HTMLElement, text: string): void {
  expect(el.getAttribute('title')).toBeNull();
  markTruncated(el);
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  expect(el.getAttribute('title')).toBe(text);
}

import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagPickDialog } from './TagPickDialog';

const MD_PATH = '地点/[郴](chēn)州市';

vi.mock('../../shared/api', () => ({
  api: {
    listTags: () =>
      Promise.resolve([
        { id: 1, path: '工作', depth: 1, self_count: 1, subtree_count: 2 },
        { id: 2, path: MD_PATH, depth: 2, self_count: 1, subtree_count: 1 },
      ]),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

const render = (onPick: (path: string, includeChildren: boolean) => void): void => {
  act(() =>
    root.render(
      createElement(TagPickDialog, { exclude: false, selected: [], onClose: () => {}, onPick }),
    ),
  );
};

describe('标签选择对话框:md 名字走纯文本形态', () => {
  it('行文案与 title 显示纯文本,不含行内 md 语法', async () => {
    render(() => {});
    await flush();
    const rows = [...host.querySelectorAll('ul button')] as HTMLElement[];
    const md = rows[1];
    expect(md.textContent).toContain('地点/郴州市');
    expect(md.textContent).not.toContain('[郴](chēn)州市');
    expectHoverTitle(md, '地点/郴州市');
  });

  it('点行回传的仍是原始路径(显示口径不污染数据)', async () => {
    const onPick = vi.fn();
    render(onPick);
    await flush();
    act(() => (host.querySelectorAll('ul button')[1] as HTMLElement).click());
    expect(onPick).toHaveBeenCalledWith(MD_PATH, true);
  });
});
