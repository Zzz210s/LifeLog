// @vitest-environment jsdom
/**
 * 标签菜单两档(标签角色 spec §5):「角色…」勾选/取消该标签的认领、「设为角色」登记/取消登记;
 * 既有的「携带…」面板候选**只列已登记的角色标签**(R3),未登记的不进候选。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagMenu } from './TagMenu';
import { buildTree } from './tag-tree';
import type { ManagedNode } from './tag-tree';

const { listRoles, listTagRoles, setTagRoles, registerRole, unregisterRole } = vi.hoisted(() => ({
  listRoles: vi.fn(),
  listTagRoles: vi.fn(),
  setTagRoles: vi.fn(),
  registerRole: vi.fn(),
  unregisterRole: vi.fn(),
}));

vi.mock('../../shared/api', () => ({
  api: {
    listRoles,
    listTagRoles,
    setTagRoles,
    registerRole,
    unregisterRole,
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
  for (const f of [listRoles, listTagRoles, setTagRoles, registerRole, unregisterRole]) f.mockReset();
  listRoles.mockResolvedValue([GUO, SUO]);
  listTagRoles.mockResolvedValue([GUO]);
  setTagRoles.mockResolvedValue(undefined);
  registerRole.mockResolvedValue(undefined);
  unregisterRole.mockResolvedValue(undefined);
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

async function openRole(): Promise<void> {
  act(() => item('角色…').click());
  await flush();
}

describe('标签菜单两档入口', () => {
  it('主面板有「角色…」与「设为角色」', async () => {
    render();
    await flush();
    expect(item('角色…')).toBeTruthy();
    expect(item('设为角色')).toBeTruthy();
  });

  it('「设为角色」调 register_role 并回报成功', async () => {
    const { onDone } = render();
    await flush();
    act(() => item('设为角色').click());
    await flush();
    expect(registerRole).toHaveBeenCalledWith(1);
    expect(onDone).toHaveBeenCalledWith('已登记为角色');
  });

  it('已是角色时显示「取消角色」并调 unregister_role', async () => {
    listRoles.mockResolvedValue([{ tagId: 1, path: '中国', name: '中国' }, GUO]);
    const { onDone } = render();
    await flush();
    act(() => item('取消角色').click());
    await flush();
    expect(unregisterRole).toHaveBeenCalledWith(1);
    expect(onDone).toHaveBeenCalledWith('已取消角色登记');
  });
});

describe('角色…面板:勾选/取消认领', () => {
  it('列出全部已登记角色,当前认领项为勾选态', async () => {
    render();
    await openRole();
    const rows = [...host.querySelectorAll('[role="menuitemcheckbox"]')] as HTMLElement[];
    expect(rows.map((r) => r.textContent?.replace('✓', '').trim())).toEqual(['国籍', '所在']);
    expect(rows[0].getAttribute('aria-checked')).toBe('true');
    expect(rows[1].getAttribute('aria-checked')).toBe('false');
  });

  it('勾选另一个角色 -> set_tag_roles 带上完整集合(整体替换)', async () => {
    render();
    await openRole();
    const rows = [...host.querySelectorAll('[role="menuitemcheckbox"]')] as HTMLElement[];
    act(() => rows[1].click());
    await flush();
    expect(setTagRoles).toHaveBeenCalledWith(1, [10, 11]);
  });

  it('取消已认领的角色 -> 集合里去掉它', async () => {
    render();
    await openRole();
    const rows = [...host.querySelectorAll('[role="menuitemcheckbox"]')] as HTMLElement[];
    act(() => rows[0].click());
    await flush();
    expect(setTagRoles).toHaveBeenCalledWith(1, []);
  });

  it('后端中文错误就地显示', async () => {
    setTagRoles.mockRejectedValue('认领的角色必须是已登记的角色标签: 99');
    render();
    await openRole();
    const rows = [...host.querySelectorAll('[role="menuitemcheckbox"]')] as HTMLElement[];
    act(() => rows[1].click());
    await flush();
    expect(host.textContent).toContain('必须是已登记的角色标签');
  });
});

describe('携带候选只列已登记角色(R3)', () => {
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
