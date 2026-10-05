// @vitest-environment jsdom
/**
 * 标签菜单两档(标签类型 spec §5):「类型…」勾选/取消该标签的认领、「设为类型」登记/取消登记;
 * 既有的「携带…」面板候选**只列已登记的类型标签**(R3),未登记的不进候选。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagMenu } from './TagMenu';
import { buildTree } from './tag-tree';
import type { ManagedNode } from './tag-tree';

const { listTypes, listTagTypes, setTagTypes, setTagTypeFlag } = vi.hoisted(() => ({
  listTypes: vi.fn(),
  listTagTypes: vi.fn(),
  setTagTypes: vi.fn(),
  setTagTypeFlag: vi.fn(),
}));

vi.mock('../../shared/api', () => ({
  api: {
    listTypes,
    listTagTypes,
    setTagTypes,
    setTagTypeFlag,
    listTagCarries: () => Promise.resolve({ carried: [], carriersOf: [] }),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GUO = { tagId: 10, path: '地点轴/国籍', name: '国籍' };
const SUO = { tagId: 11, path: '地点轴/所在', name: '所在' };
const SELF = { id: 1, path: '中国', depth: 1, sort_order: 0, self_count: 1, subtree_count: 1 };
const PLAIN = { id: 2, path: '未登记标签', depth: 1, sort_order: 1, self_count: 0, subtree_count: 0 };
const GUO_ROW = { id: 10, path: '地点轴/国籍', depth: 2, sort_order: 0, self_count: 0, subtree_count: 0 };
const SUO_ROW = { id: 11, path: '地点轴/所在', depth: 2, sort_order: 1, self_count: 0, subtree_count: 0 };
const node = buildTree([SELF] as never)[0] as ManagedNode;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  for (const f of [listTypes, listTagTypes, setTagTypes, setTagTypeFlag]) f.mockReset();
  listTypes.mockResolvedValue([GUO, SUO]);
  listTagTypes.mockResolvedValue([GUO]);
  setTagTypes.mockResolvedValue(undefined);
  setTagTypeFlag.mockResolvedValue(undefined);
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

function render(onDone = vi.fn()): { onDone: typeof onDone } {
  act(() => {
    root.render(
      createElement(TagMenu, {
        node,
        x: 10,
        y: 10,
        tagRows: [SELF, GUO_ROW, SUO_ROW, PLAIN] as never,
        tagMru: null,
        onClose: vi.fn(),
        onDone,
      })
    );
  });
  return { onDone };
}

const item = (text: string): HTMLElement =>
  [...host.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], button')].find(
    (b) => b.textContent?.trim() === text
  ) as HTMLElement;

async function openType(): Promise<void> {
  act(() => item('类型…').click());
  await flush();
}

describe('标签菜单两档入口', () => {
  it('主面板有「类型…」与「设为类型」', async () => {
    render();
    await flush();
    expect(item('类型…')).toBeTruthy();
    expect(item('设为类型')).toBeTruthy();
  });

  it('「设为类型」调 set_tag_type_flag 并回报成功', async () => {
    const { onDone } = render();
    await flush();
    act(() => item('设为类型').click());
    await flush();
    expect(setTagTypeFlag).toHaveBeenCalledWith(1, true);
    expect(onDone).toHaveBeenCalledWith('已登记为类型');
  });

  it('已是类型时显示「取消类型」并调 set_tag_type_flag(false)', async () => {
    listTypes.mockResolvedValue([{ tagId: 1, path: '中国', name: '中国' }, GUO]);
    const { onDone } = render();
    await flush();
    act(() => item('取消类型').click());
    await flush();
    expect(setTagTypeFlag).toHaveBeenCalledWith(1, false);
    expect(onDone).toHaveBeenCalledWith('已取消类型登记');
  });
});

describe('类型…面板:勾选/取消认领', () => {
  it('列出全部已登记类型,当前认领项为勾选态(中文文案,不是对勾符号)', async () => {
    render();
    await openType();
    const rows = [...host.querySelectorAll('[role="menuitemcheckbox"]')] as HTMLElement[];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('国籍');
    expect(rows[1].textContent).toContain('所在');
    expect(rows[0].textContent).toContain('已认领');
    expect(rows[1].textContent).toContain('未认领');
    expect(rows[0].getAttribute('aria-checked')).toBe('true');
    expect(rows[1].getAttribute('aria-checked')).toBe('false');
    expect(host.textContent).not.toMatch(/\u2713/u);
  });

  it('勾选另一个类型 -> set_tag_types 带上完整集合(整体替换)', async () => {
    render();
    await openType();
    const rows = [...host.querySelectorAll('[role="menuitemcheckbox"]')] as HTMLElement[];
    act(() => rows[1].click());
    await flush();
    expect(setTagTypes).toHaveBeenCalledWith(1, [10, 11]);
  });

  it('取消已认领的类型 -> 集合里去掉它', async () => {
    render();
    await openType();
    const rows = [...host.querySelectorAll('[role="menuitemcheckbox"]')] as HTMLElement[];
    act(() => rows[0].click());
    await flush();
    expect(setTagTypes).toHaveBeenCalledWith(1, []);
  });

  it('后端中文错误就地显示', async () => {
    setTagTypes.mockRejectedValue('认领的类型必须是已登记的类型标签: 99');
    render();
    await openType();
    const rows = [...host.querySelectorAll('[role="menuitemcheckbox"]')] as HTMLElement[];
    act(() => rows[1].click());
    await flush();
    expect(host.textContent).toContain('必须是已登记的类型标签');
  });
});

describe('携带候选只列已登记类型(R3)', () => {
  it('未登记的标签不进候选', async () => {
    render();
    await flush();
    act(() => item('携带…').click());
    await flush();
    const texts = [...host.querySelectorAll('[data-carry-candidate]')].map((el) => el.textContent?.trim());
    expect(texts).toEqual(['地点轴/国籍', '地点轴/所在']);
    expect(texts).not.toContain('未登记标签');
  });
});
