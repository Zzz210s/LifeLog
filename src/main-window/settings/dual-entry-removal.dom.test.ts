// @vitest-environment jsdom
/**
 * 反向守护(任务书 2026-10-17 档 1 第 ④ 条):同一状态原本有两条入口 ——
 * `sidebar_click_mode`(单击行为)与 `tag_tree_show_relations`(树里显示关系)各在侧栏头部
 * 有一颗图标、又在设置 > 实体关系有一行。现只留设置页:
 *   ① 侧栏头部不再有「点击行为」「实体树里显示关系」这两个 aria-label(也不再是开关);
 *   ② 设置页那两行仍在,而且能改值(单击回调真的带出新值)。
 * 头部其余三颗图标(搜索 / 树-扁平 / 筛选)由 tags-header-icons 钉住,这里不重复。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SidebarClickMode } from '../sidebar/click-mode';
import { TagsHeader } from '../sidebar/TagsHeader';
import { EntityTreeRows } from './EntityTreeRows';

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

const labels = (): (string | null)[] =>
  [...host.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));

describe('侧栏头部:被删的两条入口不再出现', () => {
  it('只有三颗图标,没有「点击行为」「实体树里显示关系」也没有切换开关', async () => {
    await act(async () =>
      root.render(
        createElement(TagsHeader, {
          flash: null,
          mode: 'tree',
          onModeChange: () => {},
          onFilterTags: () => {},
          searchOpen: false,
          query: '',
          ime: { onChange: () => {}, onCompositionEnd: () => {} },
          onToggleSearch: () => {},
          onCloseSearch: () => {},
        })
      )
    );
    const all = labels();
    expect(all).toEqual(['搜索标签', '切换为扁平列表', '筛选标签']);
    expect(all.some((l) => (l ?? '').startsWith('点击行为'))).toBe(false);
    expect(all).not.toContain('实体树里显示关系');
    expect(host.querySelector('[data-testid="click-mode-button"]')).toBeNull();
    expect(host.querySelector('[role="switch"]')).toBeNull();
  });
});

describe('设置页那两行仍在,且能改值', () => {
  const renderRows = async (over: {
    showRelations?: boolean;
    clickMode?: SidebarClickMode;
    onShowRelationsChange?: (v: boolean) => void;
    onChangeClickMode?: (m: SidebarClickMode) => void;
  } = {}): Promise<void> => {
    await act(async () =>
      root.render(
        createElement(EntityTreeRows, {
          showRelations: over.showRelations ?? true,
          clickMode: over.clickMode ?? 'open',
          onShowRelationsChange: over.onShowRelationsChange ?? (() => {}),
          onChangeClickMode: over.onChangeClickMode ?? (() => {}),
        })
      )
    );
  };

  it('两行都在:实体树里显示关系(开关) + 单击实体行的行为(两档)', async () => {
    await renderRows();
    expect(host.textContent).toContain('实体树里显示关系');
    expect(host.textContent).toContain('单击实体行的行为');
    expect(host.querySelector('[data-testid="tag-tree-relations-toggle"]')?.getAttribute('aria-checked')).toBe(
      'true'
    );
  });

  it('开关能改值:点击回调带出相反值', async () => {
    const seen: boolean[] = [];
    await renderRows({ showRelations: true, onShowRelationsChange: (v) => seen.push(v) });
    await act(async () => (host.querySelector('[data-testid="tag-tree-relations-toggle"]') as HTMLElement).click());
    expect(seen).toEqual([false]);
  });

  it('单击行为能改值:点另一档回调带出该档', async () => {
    const seen: SidebarClickMode[] = [];
    await renderRows({ clickMode: 'open', onChangeClickMode: (m) => seen.push(m) });
    const group = host.querySelector('[role="group"][aria-label="单击实体行的行为"]')!;
    const filterBtn = [...group.querySelectorAll('button')].find((b) => b.textContent === '筛选')!;
    await act(async () => (filterBtn as HTMLElement).click());
    expect(seen).toEqual(['filter']);
  });
});
