// @vitest-environment jsdom
/**
 * 携带面板的加载态与鼠标采纳细节(自 tag-menu-carry-order.dom.test.ts 抽出,守 200 行上限):
 * 读取未回来时禁用输入与候选、Enter 不写库;查询无命中给空态;候选 mousedown 采纳并 preventDefault。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TagCount } from '../../shared/types';
import { TagMenuCarryPane } from './TagMenuCarryPane';

const { listTagCarries, setTagCarry, removeTagCarry, listRoles } = vi.hoisted(() => ({
  listTagCarries: vi.fn(),
  setTagCarry: vi.fn(),
  removeTagCarry: vi.fn(),
  listRoles: vi.fn(),
}));
vi.mock('../../shared/api', () => ({ api: { listTagCarries, setTagCarry, removeTagCarry, listRoles } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const at = (id: number, path: string): TagCount => ({
  id,
  path,
  depth: 1,
  sort_order: id,
  self_count: 0,
  subtree_count: 0,
});
const SELF = at(1, '携带测试甲');
const OTHER = at(3, '携带测试丙');
const PINNABLE = at(4, '出版年份');
const ROWS = [SELF, OTHER, PINNABLE];

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  listTagCarries.mockReset();
  setTagCarry.mockReset();
  removeTagCarry.mockReset();
  listRoles.mockReset();
  listRoles.mockResolvedValue([
    { tagId: OTHER.id, path: OTHER.path, name: OTHER.path },
    { tagId: PINNABLE.id, path: PINNABLE.path, name: PINNABLE.path },
  ]);
  listTagCarries.mockResolvedValue({ carried: [], carriersOf: [] });
  setTagCarry.mockResolvedValue(undefined);
  removeTagCarry.mockResolvedValue(undefined);
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

const renderPane = (): void => {
  act(() => {
    root.render(
      createElement(TagMenuCarryPane, {
        tagId: 1,
        path: '携带测试甲',
        rows: ROWS,
        roles: [OTHER, PINNABLE].map((r) => ({ tagId: r.id, path: r.path, name: r.path })),
        onCancel: () => {},
      })
    );
  });
};

const paneInput = (): HTMLInputElement =>
  host.querySelector('input[aria-label="添加携带标签"]') as HTMLInputElement;
const candidateTexts = (): string[] =>
  [...host.querySelectorAll('[data-carry-candidate]')].map((el) => el.textContent?.trim() ?? '');

const typeQuery = (v: string): void => {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setValue?.call(paneInput(), v);
    paneInput().dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('携带面板·加载与交互细节', () => {
  it('读取未回来时输入禁用,Enter 不会写库', async () => {
    listTagCarries.mockReturnValue(new Promise(() => {}));
    renderPane();
    expect(paneInput().disabled).toBe(true);
    expect(host.textContent).toContain('加载中');
    act(() =>
      paneInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    );
    await flush();
    expect(setTagCarry).not.toHaveBeenCalled();
  });

  it('查询无命中时给空态文案', async () => {
    renderPane();
    await flush();
    typeQuery('zzzz');
    expect(candidateTexts().length).toBe(0);
    expect(host.textContent).toContain('没有匹配的标签');
  });

  it('候选用 mousedown 采纳并 preventDefault(输入框不失焦)', async () => {
    renderPane();
    await flush();
    const button = host.querySelector('[data-carry-candidate]') as HTMLElement;
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => button.dispatchEvent(ev));
    await flush();
    expect(ev.defaultPrevented).toBe(true);
    expect(setTagCarry).toHaveBeenCalledWith(1, OTHER.id);
  });
});
