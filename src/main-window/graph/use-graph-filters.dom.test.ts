// @vitest-environment jsdom
/**
 * `useGraphFilters` 的轴集合漂移(G3 真机读数 1 的根因,修复轮):
 * 「数据重载后要展开的根」判据必须是**本次重载才出现的根**,不能是「当前不在 axes 里的根」——
 * 后者会把用户刚取消勾选的轴当成新根又加回 axes(取消勾选任何未折叠的轴都完全无效)。
 * 这里按根集合不变 / 新增未折叠根 / 新增折叠根三种重载各钉一条。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GraphData, GraphNode } from '../../shared/types';
import { useGraphFilters } from './use-graph-filters';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const n = (id: number, path: string, parent: number | null, depth = 1): GraphNode => ({
  id, path, depth, parent, notes: 1, selfCount: 1, sortOrder: 0,
});

/** 根:书籍 / 地点 / 时间(「时间」是折叠根);`extra` 用来模拟重载后新出现的根 */
const dataWith = (extra: GraphNode[] = []): GraphData => ({
  nodes: [n(1, '时间', null), n(2, '时间/日期', 1, 2), n(3, '地点', null), n(4, '书籍', null), ...extra],
  edges: [],
});

type Api = ReturnType<typeof useGraphFilters>;
let api: Api | null = null;

function Harness(p: { data: GraphData | null; collapsed: readonly string[] | null }): null {
  api = useGraphFilters(p.data, p.collapsed);
  return null;
}

let root: Root;
let host: HTMLDivElement;

const render = async (data: GraphData | null, collapsed: readonly string[] | null): Promise<void> => {
  await act(async () => {
    root.render(createElement(Harness, { data, collapsed }));
  });
};

/** 模拟面板上取消勾选某轴:patch 收到的是「当前 filters + 新 axes」 */
const uncheck = async (drop: string): Promise<void> => {
  await act(async () => {
    api!.patch({ ...api!.filters, axes: api!.filters.axes.filter((a) => a !== drop) });
  });
};

beforeEach(() => {
  api = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('useGraphFilters:取消勾选的轴不会被数据重载加回来', () => {
  it('默认展开除折叠根外的轴;取消「地点」后重载(根集合不变)仍不含它', async () => {
    await render(dataWith(), ['时间']);
    expect(api!.filters.axes).toEqual(['书籍', '地点']); // 折叠根「时间」默认收起

    await uncheck('地点');
    expect(api!.filters.axes).toEqual(['书籍']);

    await render(dataWith(), ['时间']); // 重载:data 换新对象,根集合一模一样
    expect(api!.filters.axes).toEqual(['书籍']);
  });

  it('重载真的新增一个未折叠的根:它默认展开', async () => {
    await render(dataWith(), ['时间']);
    await uncheck('地点');
    await render(dataWith([n(5, '性别', null)]), ['时间']);
    expect(api!.filters.axes).toEqual(['书籍', '性别']);
  });

  it('新增的根本身是折叠根:保持收起,不自动展开', async () => {
    await render(dataWith(), ['时间']);
    await uncheck('地点');
    await render(dataWith([n(5, '性别', null)]), ['时间', '性别']);
    expect(api!.filters.axes).toEqual(['书籍']);
  });

  it('折叠根还没读到(null)时按不折叠算:读到后默认轴才收窄', async () => {
    await render(dataWith(), null);
    expect(api!.filters.axes).toEqual(['书籍', '地点', '时间']);

    await render(dataWith(), ['时间']);
    expect(api!.filters.axes).toEqual(['书籍', '地点']);
  });
});
