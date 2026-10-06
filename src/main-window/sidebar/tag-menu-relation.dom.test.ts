// @vitest-environment jsdom
/**
 * Task 4 菜单收成 5 档 + 「关系…」面板:列出全部出边(`属性名 → 目标`,属性名可改可移除)、
 * 候选添加(排除自己与已建立关系的目标)、Enter/Esc/组合态键盘与就地中文错误。
 * 判别力:主面板不得再出现「合并」「携带」「类型」「设为类型」字样。
 * 候选来源是本地 tagRows,排序走 `#` 补全那套共享引擎(shared/quickpick/model 的 buildList)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelationRef } from '../../shared/types';
import { TagMenu } from './TagMenu';
import { buildTree } from './tag-tree';
import type { ManagedNode } from './tag-tree';

const { listTagRelations, setTagRelation, removeTagRelation } = vi.hoisted(() => ({
  listTagRelations: vi.fn(),
  setTagRelation: vi.fn(),
  removeTagRelation: vi.fn(),
}));

vi.mock('../../shared/api', () => ({ api: { listTagRelations, setTagRelation, removeTagRelation } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SELF = { id: 1, path: '关系测试甲', depth: 1, sort_order: 0, self_count: 0, subtree_count: 0 };
const EDGE_TARGET = { id: 20, path: '关系测试乙', depth: 1, sort_order: 1, self_count: 0, subtree_count: 0 };
const OTHER = { id: 21, path: '关系测试丙', depth: 1, sort_order: 2, self_count: 0, subtree_count: 0 };
const ROWS = [SELF, EDGE_TARGET, OTHER];
const node = buildTree([SELF] as never)[0] as ManagedNode;

let root: Root;
let host: HTMLDivElement;
let edges: RelationRef[];

beforeEach(() => {
  listTagRelations.mockReset();
  setTagRelation.mockReset();
  removeTagRelation.mockReset();
  edges = [{ toTagId: 20, path: '关系测试乙', name: '关系测试乙', remark: '' }];
  listTagRelations.mockImplementation(() => Promise.resolve(edges.map((e) => ({ ...e }))));
  setTagRelation.mockImplementation((_from: number, to: number, remark: string) => {
    const hit = edges.find((e) => e.toTagId === to);
    edges = hit
      ? edges.map((e) => (e.toTagId === to ? { ...e, remark } : e))
      : [...edges, { toTagId: to, path: '关系测试丙', name: '关系测试丙', remark }];
    return Promise.resolve();
  });
  removeTagRelation.mockImplementation((_from: number, to: number) => {
    edges = edges.filter((e) => e.toTagId !== to);
    return Promise.resolve();
  });
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

const menuItems = (): string[] =>
  [...host.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent?.trim() ?? '');

async function openRelation(): Promise<void> {
  act(() => item('关系…').click());
  await flush();
}

const candidateTexts = (): string[] =>
  [...host.querySelectorAll('[data-relation-candidate]')].map((el) => el.textContent?.trim() ?? '');

const input = (): HTMLInputElement => host.querySelector('input[aria-label="添加关系标签"]') as HTMLInputElement;

function pressEnter(composing = false): void {
  const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
  if (composing) Object.defineProperty(ev, 'isComposing', { value: true });
  act(() => input().dispatchEvent(ev));
}

describe('Task 4 菜单恰 5 档', () => {
  it('只有 重命名/移动/别名/关系/删除,且不含合并、携带、类型字样', () => {
    render();
    expect(menuItems()).toEqual(['重命名', '移动', '别名…', '关系…', '删除']);
    expect(host.textContent).not.toContain('合并');
    expect(host.textContent).not.toContain('携带');
    expect(host.textContent).not.toContain('类型');
  });
});

describe('Task 4 关系面板', () => {
  it('渲染当前关系(备注缺失回退目标名)与候选', async () => {
    render();
    await openRelation();
    expect(host.textContent).toContain('当前关系');
    expect(host.textContent).toContain('关系测试乙');
    expect(candidateTexts()).toContain('关系测试丙');
  });

  it('属性名存在边上:行内输入框带出属性名,箭头后是目标名', async () => {
    edges = [{ toTagId: 20, path: '地点轴/日本', name: '日本', remark: '国籍' }];
    render();
    await openRelation();
    const box = host.querySelector('input[data-relation-remark="20"]') as HTMLInputElement;
    expect(box.value).toBe('国籍');
    expect(host.textContent).toContain('→ 日本');
  });

  it('候选不含自己与已建立关系的目标', async () => {
    render();
    await openRelation();
    expect(candidateTexts()).not.toContain('关系测试甲');
    expect(candidateTexts()).not.toContain('关系测试乙');
  });

  it('Enter 建立当前高亮候选的关系,面板保持打开', async () => {
    render();
    await openRelation();
    pressEnter();
    await flush();
    expect(setTagRelation).toHaveBeenCalledWith(1, 21, '');
    expect(host.querySelector('[data-tag-menu]')).not.toBeNull();
  });

  it('「移除」按钮调用 removeTagRelation', async () => {
    render();
    await openRelation();
    act(() => (host.querySelector('[data-relation-remove="20"]') as HTMLElement).click());
    await flush();
    expect(removeTagRelation).toHaveBeenCalledWith(1, 20);
  });

  it('Esc 关闭面板', async () => {
    const { onClose } = render();
    await openRelation();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('输入法组合中的 Enter 不触发添加', async () => {
    render();
    await openRelation();
    pressEnter(true);
    await flush();
    expect(setTagRelation).not.toHaveBeenCalled();
  });

  it('命令中文错误就地显示,面板不关', async () => {
    setTagRelation.mockRejectedValue('不能指向自己');
    render();
    await openRelation();
    pressEnter();
    await flush();
    expect(host.textContent).toContain('不能指向自己');
    expect(host.querySelector('[data-tag-menu]')).not.toBeNull();
  });
});
