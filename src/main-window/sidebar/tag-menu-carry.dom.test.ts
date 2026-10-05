// @vitest-environment jsdom
/**
 * Task 3 标签菜单第六档「携带…」:当前携带列表(可移除)+ 候选添加(排除自己与已携带)、
 * 只读「被 N 个标签携带」、Enter/Esc/组合态键盘与就地中文错误。
 * 候选来源是本地 tagRows,排序走 `#` 补全那套共享引擎(shared/quickpick/model 的 buildList)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagMenu } from './TagMenu';
import { TagMenuCarryPane } from './TagMenuCarryPane';
import { buildTree } from './tag-tree';
import type { ManagedNode } from './tag-tree';

const { listTagCarries, setTagCarry, removeTagCarry, listTypes } = vi.hoisted(() => ({
  listTagCarries: vi.fn(),
  setTagCarry: vi.fn(),
  removeTagCarry: vi.fn(),
  listTypes: vi.fn(),
}));

vi.mock('../../shared/api', () => ({
  api: { listTagCarries, setTagCarry, removeTagCarry, listTypes },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SELF = { id: 1, path: '携带测试甲', depth: 1, sort_order: 0, self_count: 0, subtree_count: 0 };
const CARRIED = { id: 20, path: '携带测试乙', depth: 1, sort_order: 1, self_count: 0, subtree_count: 0 };
const OTHER = { id: 21, path: '携带测试丙', depth: 1, sort_order: 2, self_count: 0, subtree_count: 0 };
const CARRIER = { id: 30, path: '出版年份', depth: 1, sort_order: 3, self_count: 0, subtree_count: 0 };
const ROWS = [SELF, CARRIED, OTHER, CARRIER];
const node = buildTree([SELF] as never)[0] as ManagedNode;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  listTagCarries.mockReset();
  setTagCarry.mockReset();
  removeTagCarry.mockReset();
  listTypes.mockReset();
  // 已登记类型:丙(21)与出版年份(30) —— 携带候选现在只列已登记类型(R3)
  listTypes.mockResolvedValue([
    { tagId: 21, path: '携带测试丙', name: '携带测试丙' },
    { tagId: 30, path: '出版年份', name: '出版年份' },
  ]);
  listTagCarries.mockResolvedValue({
    carried: [{ id: 20, path: '携带测试乙' }],
    carriersOf: [{ id: 30, path: '出版年份' }],
  });
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

function render(onClose = vi.fn()): { onClose: typeof onClose } {
  act(() => {
    root.render(
      createElement(TagMenu, { node, x: 10, y: 10, tagRows: ROWS as never, tagMru: null, onClose, onDone: vi.fn() })
    );
  });
  return { onClose };
}

const item = (text: string): HTMLElement =>
  [...host.querySelectorAll('[role="menuitem"], button')].find(
    (b) => b.textContent?.trim() === text
  ) as HTMLElement;

async function openCarry(): Promise<void> {
  act(() => item('携带…').click());
  await flush();
}

const candidateTexts = (): string[] =>
  [...host.querySelectorAll('[data-carry-candidate]')].map((el) => el.textContent?.trim() ?? '');

const input = (): HTMLInputElement => host.querySelector('input[aria-label="添加携带标签"]') as HTMLInputElement;

function pressEnter(composing = false): void {
  const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
  if (composing) Object.defineProperty(ev, 'isComposing', { value: true });
  act(() => input().dispatchEvent(ev));
}

describe('Task 3 携带面板', () => {
  it('渲染当前携带与只读「被 N 个标签携带」来源', async () => {
    render();
    await openCarry();
    expect(host.textContent).toContain('当前携带');
    expect(host.textContent).toContain('携带测试乙');
    expect(host.textContent).toContain('被 1 个标签携带');
    expect(host.textContent).toContain('出版年份');
  });

  it('无携带时显示空态文案', async () => {
    listTagCarries.mockResolvedValue({ carried: [], carriersOf: [] });
    render();
    await openCarry();
    expect(host.textContent).toContain('还没有携带任何标签');
    expect(host.textContent).toContain('被 0 个标签携带');
  });

  it('候选不含自己与已携带的标签', async () => {
    render();
    await openCarry();
    const texts = candidateTexts();
    expect(texts).toContain('携带测试丙');
    expect(texts).toContain('出版年份');
    expect(texts).not.toContain('携带测试甲');
    expect(texts).not.toContain('携带测试乙');
  });

  it('Enter 添加当前高亮候选项,面板保持打开', async () => {
    render();
    await openCarry();
    pressEnter();
    await flush();
    expect(setTagCarry).toHaveBeenCalledWith(1, 21);
    expect(host.querySelector('[data-tag-menu]')).not.toBeNull();
  });

  it('「移除」按钮调用 removeTagCarry', async () => {
    render();
    await openCarry();
    act(() => (host.querySelector('[data-carry-remove="20"]') as HTMLElement).click());
    await flush();
    expect(removeTagCarry).toHaveBeenCalledWith(1, 20);
  });

  it('Esc 关闭面板', async () => {
    const { onClose } = render();
    await openCarry();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('输入法组合中的 Enter 不触发添加', async () => {
    render();
    await openCarry();
    pressEnter(true);
    await flush();
    expect(setTagCarry).not.toHaveBeenCalled();
  });

  it('固定项档排在候选最前（三档排序注入面）', async () => {
    act(() => {
      root.render(
        createElement(TagMenuCarryPane, {
          tagId: 1,
          path: '携带测试甲',
          rows: ROWS as never,
          types: [
            { tagId: 21, path: '携带测试丙', name: '携带测试丙' },
            { tagId: 30, path: '出版年份', name: '出版年份' },
          ],
          pinned: ['出版年份'],
          onCancel: () => {},
        })
      );
    });
    await flush();
    expect(candidateTexts()[0]).toBe('出版年份');
  });

  it('命令中文错误就地显示,面板不关', async () => {
    setTagCarry.mockRejectedValue('不能携带自己');
    render();
    await openCarry();
    pressEnter();
    await flush();
    expect(host.textContent).toContain('不能携带自己');
    expect(host.querySelector('[data-tag-menu]')).not.toBeNull();
  });
});
