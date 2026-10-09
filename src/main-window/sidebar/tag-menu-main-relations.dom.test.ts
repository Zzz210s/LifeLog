// @vitest-environment jsdom
/**
 * 标签右键菜单主面板**直接列出关系**(2026-10-06 用户口径,不再靠悬浮):
 * 标题下方每条关系一行,左列属性名(muted)、右列值;超过 4 条给 `+N`;
 * 属性名缺失时左列回退目标名(与档案卡片 `tagFactsRows` 同一投影);
 * 没有关系就一行都不出。
 * 读数来源:TagMenu 打开时经 `api.listTagRelations` 读回(与「引用…」面板同一条 IPC)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelationRef } from '../../shared/types';
import { TagMenu } from './TagMenu';
import { TagMenuMainPane } from './TagMenuMainPane';
import { buildTree } from './tag-tree';
import type { ManagedNode } from './tag-tree';

const { listTagRelations } = vi.hoisted(() => ({ listTagRelations: vi.fn() }));
vi.mock('../../shared/api', () => ({ api: { listTagRelations } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rel = (toTagId: number, name: string, remark: string): RelationRef => ({
  toTagId,
  path: `地点轴/${name}`,
  name,
  remark,
});

const SELF = { id: 1, path: '关系测试甲', depth: 1, sort_order: 0, self_count: 0, subtree_count: 0 };
const node = buildTree([SELF] as never)[0] as ManagedNode;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  listTagRelations.mockReset();
  listTagRelations.mockResolvedValue([]);
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

const rows = (): HTMLElement[] => [...host.querySelectorAll('[data-menu-relation]')] as HTMLElement[];
const labels = (): string[] =>
  [...host.querySelectorAll('[data-menu-relation-label]')].map((el) => el.textContent ?? '');
const values = (): string[] =>
  [...host.querySelectorAll('[data-menu-relation-value]')].map((el) => el.textContent ?? '');

const renderPane = (relations?: RelationRef[]): void => {
  act(() => {
    root.render(createElement(TagMenuMainPane, { path: '地点轴/日本', onPick: () => {}, relations }));
  });
};

function renderMenu(): void {
  act(() => {
    root.render(createElement(TagMenu, { node, x: 10, y: 10, tagRows: [SELF] as never, tagMru: null, onClose: vi.fn(), onDone: vi.fn() }));
  });
}

describe('菜单主面板:直接列出关系', () => {
  it('每条关系一行:左列属性名 muted、右列值(与卡片同口径)', () => {
    renderPane([rel(10, '日本', '国籍'), rel(11, '中国大陆', '出生地')]);
    expect(rows()).toHaveLength(2);
    expect(labels()).toEqual(['国籍', '出生地']);
    expect(values()).toEqual(['日本', '中国大陆']);
    const first = host.querySelector('[data-menu-relation-label]') as HTMLElement;
    expect(first.className.split(/\s+/)).toContain('text-muted');
  });

  it('属性名缺失(空串):左列回退目标名,不留空行', () => {
    renderPane([rel(12, '所在', '')]);
    expect(labels()).toEqual(['所在']);
    expect(values()).toEqual(['']);
  });

  it('超过 4 条:只列 4 条 + 余数 `+N`', () => {
    renderPane([rel(10, '一', '甲'), rel(11, '二', '乙'), rel(12, '三', '丙'), rel(13, '四', '丁'), rel(14, '五', '戊')]);
    expect(rows()).toHaveLength(4);
    expect(labels()).toEqual(['甲', '乙', '丙', '丁']);
    expect(host.textContent).toContain('+1');
  });

  it('没有关系:一行都不出', () => {
    renderPane([]);
    renderPane(undefined);
    expect(rows()).toEqual([]);
    expect(host.textContent).not.toContain('+');
  });
});

describe('菜单主面板:读数直接来自 listTagRelations', () => {
  it('TagMenu 打开即读回出边并列出(无需进「引用…」子面板)', async () => {
    listTagRelations.mockResolvedValue([rel(10, '日本', '国籍')]);
    renderMenu();
    await flush();
    expect(listTagRelations).toHaveBeenCalledWith(1);
    expect(labels()).toEqual(['国籍']);
    expect(values()).toEqual(['日本']);
  });

  it('读数失败(IPC 缺失/抛错)不挂菜单:只当没有关系', async () => {
    listTagRelations.mockRejectedValue('boom');
    renderMenu();
    await flush();
    expect(host.querySelector('[data-menu-relation]')).toBeNull();
    // 五档仍在
    expect(host.textContent).toContain('引用…');
  });
});
