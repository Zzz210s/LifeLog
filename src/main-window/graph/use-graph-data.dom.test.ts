// @vitest-environment jsdom
/**
 * 关系图数据 hook 的关系边接线(Task 5):`list_tag_facts` 的批量事实穿过 `relationEdges`,
 * 成为 `relations` 交给绘制计划;标签菜单写操作后的 `reload()` 要把它一并刷新。
 * 取不到(IPC 缺项/失败)时退空数组,**不影响图本身** —— 关系是增强信息,不该把视图拖红。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphData } from '../../shared/types';
import type { RelationEdge } from './graph-relations';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { graphData, listTagFacts } = vi.hoisted(() => ({
  graphData: vi.fn(async (): Promise<GraphData> => ({ nodes: [], edges: [] })),
  listTagFacts: vi.fn(async () => ({
    facts: [{ tagId: 2, relations: [{ toTagId: 4, path: '地点轴/国籍', name: '国籍', remark: '国别' }] }],
  })),
}));
vi.mock('../../shared/api', () => ({ api: { graphData, listTagFacts } }));

import { useGraphData } from './use-graph-data';

interface Probe {
  relations: RelationEdge[];
  reload: () => void;
}

function Probe(p: { out: { current: Probe | null } }): null {
  const { relations, reload } = useGraphData();
  p.out.current = { relations, reload };
  return null;
}

let host: HTMLDivElement;
let root: Root;
const out = { current: null as Probe | null };

const mount = async (): Promise<void> => {
  await act(async () => {
    root.render(createElement(Probe, { out }));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  graphData.mockClear();
  listTagFacts.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('useGraphData:关系边', () => {
  it('事实摊平成 A -> B 的边(备注带上)', async () => {
    await mount();
    expect(listTagFacts).toHaveBeenCalledTimes(1);
    expect(out.current?.relations).toEqual([{ a: 2, b: 4, remark: '国别' }]);
  });

  it('取落失败退空,图数据照常(关系不该把视图拖红)', async () => {
    listTagFacts.mockRejectedValueOnce(new Error('库读不了'));
    await mount();
    expect(out.current?.relations).toEqual([]);
    expect(graphData).toHaveBeenCalled();
  });

  it('reload() 重取事实(标签菜单写操作后关系要跟着变)', async () => {
    await mount();
    listTagFacts.mockResolvedValueOnce({ facts: [] });
    await act(async () => {
      out.current?.reload();
      await Promise.resolve();
    });
    expect(listTagFacts).toHaveBeenCalledTimes(2);
    expect(out.current?.relations).toEqual([]);
  });
});
