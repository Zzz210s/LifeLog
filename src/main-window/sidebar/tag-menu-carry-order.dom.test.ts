// @vitest-environment jsdom
/**
 * 携带面板「三档排序」的真实数据源接线(T3 修复轮的重要项):
 * 空查询的「最近用过」档必须来自 App 里那一份 `PaletteSettings` 实例,经
 * `Sidebar → TagsSection → TagMenu` 透传 —— 从 TagsSection(侧栏真实入口)一层钉住;
 * 另覆盖加载中禁用输入/候选与鼠标采纳保焦点。
 *
 * 判别力:ROWS 的路径序把「出版年份」排在最后,拿不到 mru 就上不了首位。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTER } from '../../shared/filter-conditions';
import type { TagCount } from '../../shared/types';
import { TagMenu } from './TagMenu';
import { TagMenuCarryPane } from './TagMenuCarryPane';
import { TagsSection } from './TagsSection';
import { buildTree } from './tag-tree';
import type { ManagedNode } from './tag-tree';

const { listTagCarries, setTagCarry, removeTagCarry } = vi.hoisted(() => ({
  listTagCarries: vi.fn(),
  setTagCarry: vi.fn(),
  removeTagCarry: vi.fn(),
}));

vi.mock('../../shared/api', () => ({
  api: { listTagCarries, setTagCarry, removeTagCarry },
}));

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
const CARRIED = at(2, '携带测试乙');
const OTHER = at(3, '携带测试丙');
const PINNABLE = at(4, '出版年份'); // 路径序最后:只有 MRU / 固定项档能把它提到首位
const ROWS = [SELF, CARRIED, OTHER, PINNABLE];
const node = buildTree([SELF] as never)[0] as ManagedNode;

/** 假 MRU 源:entries 只有「出版年份」一条(次数 3) */
const tagMru = {
  pinnedTags: [] as string[],
  mruTags: { entries: () => [{ id: '出版年份', count: 3 }], touch: () => {} },
};

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  listTagCarries.mockReset();
  setTagCarry.mockReset();
  removeTagCarry.mockReset();
  listTagCarries.mockResolvedValue({ carried: [CARRIED], carriersOf: [] });
  setTagCarry.mockResolvedValue(undefined);
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

const candidateTexts = (): string[] =>
  [...host.querySelectorAll('[data-carry-candidate]')].map((el) => el.textContent?.trim() ?? '');

const menuItem = (text: string): HTMLElement => {
  const found = [...host.querySelectorAll('[role="menuitem"], button')].find(
    (b) => b.textContent?.trim() === text
  );
  if (!found) throw new Error(`菜单里没有「${text}」`);
  return found as HTMLElement;
};

/** 侧栏真实入口:右键标签行(contextmenu)-> 点「携带…」 */
async function openCarryFromSidebar(tag: TagCount, mru: typeof tagMru | null): Promise<void> {
  act(() => {
    root.render(
      createElement(TagsSection, {
        conditions: EMPTY_FILTER,
        onPatch: () => {},
        tagRows: ROWS,
        tagMru: mru,
        mode: 'tree',
        onModeChange: () => {},
        onFilterTags: () => {},
        onTagsMutated: () => {},
      })
    );
  });
  const row = host.querySelector(`[data-tag-path="${tag.path}"]`);
  if (row === null) throw new Error(`侧栏没有标签行 ${tag.path}`);
  act(() => {
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 }));
  });
  act(() => menuItem('携带…').click());
  await flush();
}

const renderPane = (): void => {
  act(() => {
    root.render(
      createElement(TagMenuCarryPane, {
        tagId: 1,
        path: '携带测试甲',
        rows: ROWS,
        onCancel: () => {},
      })
    );
  });
};

const paneInput = (): HTMLInputElement =>
  host.querySelector('input[aria-label="添加携带标签"]') as HTMLInputElement;

const typeQuery = (v: string): void => {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setValue?.call(paneInput(), v);
    paneInput().dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('携带面板·三档排序的数据源接线', () => {
  it('侧栏透传 tagMru:空查询把最近用过的标签排在最前', async () => {
    await openCarryFromSidebar(SELF, tagMru);
    expect(candidateTexts()[0]).toBe('出版年份');
  });

  it('TagMenu 一层单独看:tagMru 的固定项档同样生效', async () => {
    act(() => {
      root.render(
        createElement(TagMenu, {
          node,
          x: 10,
          y: 10,
          tagRows: ROWS,
          tagMru: { pinnedTags: ['出版年份'], mruTags: { entries: () => [], touch: () => {} } },
          onClose: () => {},
          onDone: () => {},
        })
      );
    });
    act(() => menuItem('携带…').click());
    await flush();
    expect(candidateTexts()[0]).toBe('出版年份');
  });
});

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
