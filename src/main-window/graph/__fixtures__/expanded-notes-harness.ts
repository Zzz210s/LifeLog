// @vitest-environment jsdom
/**
 * `useExpandedNotes` 的 DOM 用例装配(取数口径 / 点小圆两份主题共用,守 200 行红线)。
 * 数据层 mock(`api.queryNotes`)由用例文件自己 `vi.mock` 提供 —— `vi.mock` 必须写在用例文件里。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GraphNode, Note } from '../../../shared/types';
import type { Camera } from '../graph-camera';
import type { Point } from '../radial';
import { useExpandedNotes, type ExpandedNotesApi } from '../use-expanded-notes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 小圆离标签圆心的间距(与被测实现同一个数:改了口径这里就红) */
export const GAP = 14;

/** 414 条(含子孙)的标签;`selfCount` 是本级,展开画的是含子孙那一批 */
export const NODE: GraphNode = {
  id: 7,
  path: '工作/项目A',
  depth: 2,
  parent: 1,
  notes: 414,
  selfCount: 12,
  sortOrder: 3,
};

/** 标签落点:世界坐标 (100, 50),屏幕位置就是 (230, 90);相机故意不是恒等变换(k=2 / tx=30 / ty=-10),
 * 这样屏幕口径下小圆会落在 (230, 90) 周围,而不是仍停在世界坐标 (100, 50) 上(两种实现能区分);容器原点 (10, 20) */
export const POINTS = new Map<number, Point>([[7, { x: 100, y: 50 }]]);
export const CAM: Camera = { k: 2, tx: 30, ty: -10 };
export const ORIGIN = { x: 10, y: 20 };

/** 第一页的读数:后端页大小 50,足以覆盖 20 个圆 */
export const page = (n: number): Note[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    content: `笔记${i + 1}`,
    created_at: '2026-09-29 10:00:00',
    links: [],
    tags: ['工作/项目A'],
  }));

export interface MountedExpanded {
  /** hook 句柄(每次渲染刷新,断言必须取最新一份) */
  api: () => ExpandedNotesApi | null;
  /** 点小圆回传的标签路径 */
  filtered: () => string[];
  /** 挂载并 flush 取数回包(拒包也算回包) */
  mount: (node: GraphNode | null) => Promise<void>;
  unmount: () => void;
}

export function mountExpandedNotes(): MountedExpanded {
  let api: ExpandedNotesApi | null = null;
  let filtered: string[] = [];
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);

  function Harness(p: { node: GraphNode | null }): null {
    api = useExpandedNotes({
      node: p.node,
      points: POINTS,
      cam: CAM,
      origin: () => ORIGIN,
      onFilterToStream: (path) => filtered.push(path),
    });
    return null;
  }

  return {
    api: () => api,
    filtered: () => filtered,
    mount: async (node) => {
      await act(async () => {
        root.render(createElement(Harness, { node }));
      });
      await act(async () => {
        await Promise.resolve();
      });
    },
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}
