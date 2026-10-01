// @vitest-environment jsdom
/**
 * 侧栏标签树的收窄搜索(拾枝 ①):放大镜默认收起(0 个 input),
 * 输入即按名字收窄树(命中保留祖先链)、Esc 清空并收起、无命中给中文提示;
 * 树/扁平两种模式都吃同一份收窄结果。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { TagCount } from '../../shared/types';
import { TagsSection } from './TagsSection';
import type { TagViewMode } from './use-sidebar-state';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rows: TagCount[] = [
  { id: 1, path: '工作', depth: 1, sort_order: 0, self_count: 0, subtree_count: 2 },
  { id: 2, path: '工作/项目A', depth: 2, sort_order: 0, self_count: 1, subtree_count: 2 },
  { id: 3, path: '工作/项目A/会议', depth: 3, sort_order: 0, self_count: 2, subtree_count: 2 },
  { id: 4, path: '生活', depth: 1, sort_order: 0, self_count: 1, subtree_count: 1 },
];

let host: HTMLDivElement;
let root: Root;

const render = async (mode: TagViewMode = 'tree'): Promise<void> => {
  await act(async () =>
    root.render(
      createElement(TagsSection, {
        conditions: EMPTY_FILTER,
        onPatch: () => {},
        tagRows: rows,
        mode,
        onModeChange: () => {},
        onFilterTags: () => {},
        onTagsMutated: () => {},
      })
    )
  );
};

const paths = (): string[] =>
  [...host.querySelectorAll('[data-tag-path]')].map((el) => el.getAttribute('data-tag-path') ?? '');
const searchButton = (): HTMLElement => host.querySelector('button[aria-label="搜索标签"]') as HTMLElement;
const input = (): HTMLInputElement => host.querySelector('input') as HTMLInputElement;

/** 受控 input:React 认的是原生 setter 之后的 input 事件 */
const type = (v: string): void => {
  const el = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const press = (key: string): void => {
  act(() => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
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

describe('侧栏标签树收窄搜索', () => {
  it('默认收起:0 个 input,全量 4 行', async () => {
    await render();
    expect(host.querySelectorAll('input').length).toBe(0);
    expect(paths()).toEqual(['工作', '工作/项目A', '工作/项目A/会议', '生活']);
  });

  it('输入即收窄,且命中节点的祖先链仍在', async () => {
    await render();
    await act(async () => searchButton().click());
    type('会议');
    expect(paths()).toEqual(['工作', '工作/项目A', '工作/项目A/会议']); // 祖先保留,「生活」被裁掉
  });

  it('Esc 清空并收起:输入框消失、行数恢复', async () => {
    await render();
    await act(async () => searchButton().click());
    type('会议');
    expect(paths()).toHaveLength(3);
    press('Escape');
    expect(host.querySelectorAll('input').length).toBe(0);
    expect(paths()).toHaveLength(4);
  });

  it('再点放大镜收起:同样清空,不留隐式收窄的树', async () => {
    await render();
    await act(async () => searchButton().click());
    type('会议');
    await act(async () => searchButton().click());
    expect(host.querySelectorAll('input').length).toBe(0);
    expect(paths()).toHaveLength(4);
  });

  it('无命中:0 行 + 中文提示', async () => {
    await render();
    await act(async () => searchButton().click());
    type('zzz');
    expect(paths()).toHaveLength(0);
    expect(host.textContent).toContain('没有匹配的标签');
  });

  it('扁平模式吃同一份收窄结果(显示完整路径,「生活」被裁掉)', async () => {
    await render('flat');
    await act(async () => searchButton().click());
    type('会议');
    expect(paths()).toEqual(['工作', '工作/项目A', '工作/项目A/会议']);
  });
});
