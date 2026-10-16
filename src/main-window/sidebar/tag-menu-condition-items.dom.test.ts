// @vitest-environment jsdom
/**
 * T3 菜单条件档(设计 §5.6):`TagMenuMainPane` 从 5 档到 8 档,新增的**三档排在最前**
 * —— 仅看本级 / 含子级(menuitemcheckbox,aria-checked 读条件态)/ 加入-移出排除(切换)。
 * 条件态由 `TagMenu` 从 `conditions` 派生后透传;动作回调由上层(T4)落到 T1 的纯函数上,
 * 所以这一层的读数 = 档位顺序 / 文案 / aria-checked / 回调次数。
 */
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTER, type FilterConditions } from '../../shared/filter-conditions';
import { addGroupItem } from '../../shared/filter-groups';
import { TagMenu, type TagMenuProps } from './TagMenu';
import { TagMenuMainPane, type TagMenuMainPaneProps } from './TagMenuMainPane';
import { buildTree } from './tag-tree';
import type { ManagedNode } from './tag-tree';

const { listTagRelations } = vi.hoisted(() => ({ listTagRelations: vi.fn() }));
vi.mock('../../shared/api', () => ({ api: { listTagRelations } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PATH = '关系测试甲';
const node = buildTree([{ id: 1, path: PATH, depth: 1, sort_order: 0, self_count: 1, subtree_count: 1 }] as never)[0] as ManagedNode;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  listTagRelations.mockResolvedValue([]);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (el: ReactElement): void => {
  act(() => root.render(el));
};

const pane = (over: Partial<TagMenuMainPaneProps> = {}): void =>
  render(
    createElement(TagMenuMainPane, {
      path: PATH,
      onPick: over.onPick ?? (() => {}),
      relations: over.relations,
      inIncluded: over.inIncluded ?? false,
      includeChildren: over.includeChildren ?? false,
      excluded: over.excluded ?? false,
      onScope: over.onScope ?? (() => {}),
      onToggleExclude: over.onToggleExclude ?? (() => {}),
    })
  );

const menu = (conditions?: FilterConditions, over: Partial<TagMenuProps> = {}): void =>
  render(
    createElement(TagMenu, {
      node,
      x: 10,
      y: 10,
      tagRows: [],
      tagMru: null,
      onClose: () => {},
      onDone: () => {},
      conditions,
      ...over,
    })
  );

const actions = (): (string | null)[] =>
  [...host.querySelectorAll('[data-menu-action]')].map((el) => el.getAttribute('data-menu-action'));
const item = (action: string): HTMLElement => {
  const el = host.querySelector<HTMLElement>(`[data-menu-action="${action}"]`);
  if (el === null) throw new Error(`菜单项缺失:${action}`);
  return el;
};
const texts = (): string[] => [...host.querySelectorAll('[data-menu-action]')].map((el) => el.textContent?.trim() ?? '');
const clickItem = (action: string): void => {
  act(() => item(action).click());
};

describe('菜单 8 档(§5.6:条件动作在前、管理动作在后)', () => {
  it('顺序与文案 = 仅看本级 / 含子级 / 加入排除 / 重命名 / 移动 / 别名… / 关系… / 删除', () => {
    pane();
    expect(actions()).toEqual([
      'scope-self',
      'scope-subtree',
      'exclude',
      'rename',
      'move',
      'alias',
      'relation',
      'delete',
    ]);
    expect(texts()).toEqual(['仅看本级', '含子级', '加入排除', '重命名', '移动', '别名…', '关系…', '删除']);
  });

  it('无障碍:两个 scope 档是 menuitemcheckbox,排除档是 menuitem;三档都不做禁用态', () => {
    pane();
    expect(item('scope-self').getAttribute('role')).toBe('menuitemcheckbox');
    expect(item('scope-subtree').getAttribute('role')).toBe('menuitemcheckbox');
    expect(item('exclude').getAttribute('role')).toBe('menuitem');
    for (const a of ['scope-self', 'scope-subtree', 'exclude']) {
      expect(item(a).hasAttribute('disabled')).toBe(false);
      expect(item(a).getAttribute('aria-disabled')).toBeNull();
    }
  });

  it('aria-checked:仅看本级 = 在包含侧且 includeChildren 为假;含子级 = 在包含侧且为真', () => {
    pane();
    expect([item('scope-self').getAttribute('aria-checked'), item('scope-subtree').getAttribute('aria-checked')])
      .toEqual(['false', 'false']);

    pane({ inIncluded: true, includeChildren: false });
    expect([item('scope-self').getAttribute('aria-checked'), item('scope-subtree').getAttribute('aria-checked')])
      .toEqual(['true', 'false']);

    pane({ inIncluded: true, includeChildren: true });
    expect([item('scope-self').getAttribute('aria-checked'), item('scope-subtree').getAttribute('aria-checked')])
      .toEqual(['false', 'true']);
  });

  it('排除档文案:未排除 = 「加入排除」,已在排除侧 = 「移出排除」', () => {
    pane();
    expect(item('exclude').textContent).toBe('加入排除');
    pane({ excluded: true });
    expect(item('exclude').textContent).toBe('移出排除');
  });

  it('三档各自回调一次(带口径 / 切换),且不切子面板', () => {
    const onScope = vi.fn();
    const onToggleExclude = vi.fn();
    const onPick = vi.fn();
    pane({ onScope, onToggleExclude, onPick });

    clickItem('scope-self');
    expect(onScope).toHaveBeenLastCalledWith(false);
    clickItem('scope-subtree');
    expect(onScope).toHaveBeenLastCalledWith(true);
    expect(onScope).toHaveBeenCalledTimes(2);
    clickItem('exclude');
    expect(onToggleExclude).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
    expect(actions()).toHaveLength(8); // 点了三档仍在主面板(没有切到子面板)
  });
});

describe('TagMenu 把条件态派生给主面板', () => {
  it('该行在包含侧(含子级):含子级勾上;动作回传路径 + 口径', () => {
    const withTag = addGroupItem(EMPTY_FILTER, { kind: 'tag', path: PATH, includeChildren: true });
    const onScope = vi.fn();
    menu(withTag, { onScope });
    expect(item('scope-subtree').getAttribute('aria-checked')).toBe('true');
    expect(item('scope-self').getAttribute('aria-checked')).toBe('false');
    clickItem('scope-self');
    expect(onScope).toHaveBeenCalledWith(PATH, false);
  });

  it('该行在排除侧:文案变「移出排除」,点了回调一次', () => {
    const excluded = addGroupItem(EMPTY_FILTER, { kind: 'excludeTag', path: PATH, includeChildren: false });
    const onToggleExclude = vi.fn();
    menu(excluded, { onToggleExclude });
    expect(item('exclude').textContent).toBe('移出排除');
    expect(item('scope-self').getAttribute('aria-checked')).toBe('false');
    clickItem('exclude');
    expect(onToggleExclude).toHaveBeenCalledWith(PATH);
  });

  it('条件态缺省(接线前)时不炸:三档照常渲染,勾选全关、文案「加入排除」', () => {
    menu();
    expect(actions()[0]).toBe('scope-self');
    expect(item('exclude').textContent).toBe('加入排除');
    expect(item('scope-subtree').getAttribute('aria-checked')).toBe('false');
  });
});
