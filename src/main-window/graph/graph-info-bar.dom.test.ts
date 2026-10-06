// @vitest-environment jsdom
/**
 * 关系图右侧信息条(G2 Task 4):选中的标签详情 —— 路径、本级/含子级计数、两个动作。
 * 钉住:两个计数的文案口径(与画布气泡同源)、按钮回调、展开态文案切换、长路径不破版。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../shared/types';
import { GraphInfoBar } from './GraphInfoBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const node: GraphNode = {
  id: 2,
  path: '地点/所在/中国',
  depth: 3,
  parent: 1,
  notes: 414,
  selfCount: 3,
  sortOrder: 0,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

async function render(el: React.ReactElement): Promise<void> {
  await act(async () => {
    root.render(el);
  });
}

const buttons = (): HTMLButtonElement[] => [...host.querySelectorAll('button')];

const find = (text: string): HTMLButtonElement => {
  const b = buttons().find((x) => x.textContent?.includes(text));
  if (b === undefined) throw new Error(`没有文案含「${text}」的按钮`);
  return b;
};

describe('GraphInfoBar:路径与两个计数 + 两个动作', () => {
  it('显示路径、本级、含子级', async () => {
    await render(
      createElement(GraphInfoBar, {
        node,
        relationDegrees: { outbound: 3, backlinks: 1 },
        onFilterToStream: () => {},
        onToggleExpand: () => {},
        expanded: false,
      }),
    );
    expect(host.textContent).toContain('地点/所在/中国');
    expect(host.textContent).toContain('本级 3');
    expect(host.textContent).toContain('含子级 414');
  });

  it('标签关系出/入度单独一行(关系（含子孙）：出 N / 入 M)', async () => {
    await render(
      createElement(GraphInfoBar, {
        node,
        relationDegrees: { outbound: 3, backlinks: 1 },
        onFilterToStream: () => {},
        onToggleExpand: () => {},
        expanded: false,
      }),
    );
    const row = host.querySelector('[data-testid="graph-relation-degrees"]');
    expect(row?.textContent?.replace(/\s+/g, ' ').trim()).toBe('关系（含子孙）：出 3 / 入 1');
  });

  it('按钮触发回调,展开态文案随之变化', async () => {
    const onFilter = vi.fn();
    const onToggle = vi.fn();
    await render(
      createElement(GraphInfoBar, {
        node,
        relationDegrees: { outbound: 0, backlinks: 0 },
        onFilterToStream: onFilter,
        onToggleExpand: onToggle,
        expanded: false,
      }),
    );
    await act(async () => {
      find('筛到信息流').click();
    });
    expect(onFilter).toHaveBeenCalled();
    await act(async () => {
      find('展开笔记').click();
    });
    expect(onToggle).toHaveBeenCalled();
  });

  it('已展开时按钮文案是「收起笔记」', async () => {
    await render(
      createElement(GraphInfoBar, {
        node,
        relationDegrees: { outbound: 0, backlinks: 0 },
        onFilterToStream: () => {},
        onToggleExpand: () => {},
        expanded: true,
      }),
    );
    expect(host.textContent).toContain('收起笔记');
  });

  it('长路径不破版:路径节点带 break-all,计数与按钮各占一行', async () => {
    const long: GraphNode = { ...node, path: `地点/${'很长的层级/'.repeat(12)}末端` };
    await render(
      createElement(GraphInfoBar, {
        node: long,
        relationDegrees: { outbound: 0, backlinks: 0 },
        onFilterToStream: () => {},
        onToggleExpand: () => {},
        expanded: false,
      }),
    );
    const path = [...host.querySelectorAll('*')].find((el) => el.textContent === long.path);
    expect(path).toBeDefined();
    expect(path!.className).toContain('break-all');
    expect(host.textContent).toContain('Esc 返回信息流');
  });
});
