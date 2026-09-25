// @vitest-environment jsdom
/**
 * 拖拽单测共用夹具(仅测试引用):jsdom 里真渲染 useTagDrag,并给出可查询的行 / 边界带 / 根级区。
 * 事件一律页面内合成(不碰 OS 鼠标);jsdom 没有 DragEvent/DataTransfer,故在普通 Event 上挂
 * dataTransfer / clientX / clientY 三个属性,React 的合成事件与我们的处理器读法一致。
 * 树夹具:工作(1) / 工作/项目A(2) / 工作/项目B(4) / 生活(5) / 生活/兜底(id null 的结构节点),
 * 显示序见 visible。结构节点只有 500ms 自动展开一类兜底数据才会出现,这里用来测 T4 冒泡。
 */
import { act, createElement, useRef } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import { bandHalves } from '../drag-resolve';
import type { BandSideRef } from '../drag-resolve';
import type { TagNode } from '../tag-tree';
import { useTagDrag } from '../use-tag-drag';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const node = (id: number | null, path: string, children: TagNode[] = []): TagNode => ({
  id,
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  depth: path.split('/').length,
  sortOrder: 0,
  selfCount: 1,
  subtreeCount: 1,
  children,
});

export const roots: TagNode[] = [
  node(1, '工作', [node(2, '工作/项目A'), node(4, '工作/项目B')]),
  node(5, '生活', [node(null, '生活/兜底')]),
];
const visible: TagNode[] = [roots[0], roots[0].children[0], roots[0].children[1], roots[1], roots[1].children[0]];

interface FakeDt {
  dropEffect: string;
  effectAllowed: string;
  setDragImage: () => void;
}

/** 合成的 DataTransfer 替身(赋值可写、不可读回,与真实合成拖拽一致) */
export const fakeDt = (): FakeDt => ({ dropEffect: 'none', effectAllowed: 'none', setDragImage: () => {} });

/** 合成拖拽事件:普通 Event + dataTransfer/clientX/clientY */
export const dragEv = (type: string, data: unknown, x = 10, y = 10): Event => {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: data });
  Object.defineProperty(ev, 'clientX', { value: x });
  Object.defineProperty(ev, 'clientY', { value: y });
  return ev;
};

function Harness(p: {
  onMoved: (c: { from: string; to: string }) => void;
  onError: (m: string) => void;
  onAutoExpand: (p: string) => void;
}): ReactNode {
  const listRef = useRef<HTMLDivElement | null>(null);
  const drag = useTagDrag({
    roots,
    expanded: () => false,
    onAutoExpand: p.onAutoExpand,
    listRef,
    onMoved: p.onMoved,
    onError: p.onError,
  });
  const active = (s: BandSideRef): string | undefined =>
    drag.over && drag.over.path === s.path && drag.over.zone === s.zone ? 'true' : undefined;
  const bandSide = (side: string, s: BandSideRef): ReactNode =>
    createElement('span', {
      key: side,
      'data-band': `${side}:${s.path}:${s.zone}`,
      'data-active': active(s),
      onDragOver: (e: React.DragEvent) => drag.bandEvents.onDragOverBand(e, s.path, s.zone),
      onDragLeave: drag.bandEvents.onDragLeaveBand,
      onDrop: (e: React.DragEvent) => drag.bandEvents.onDropBand(e, s.path, s.zone),
    });
  return createElement(
    'div',
    null,
    createElement(
      'div',
      { ref: listRef, 'data-testid': 'list', onDragLeave: drag.listEvents.onDragLeaveList },
      visible.map((n) =>
        createElement('button', {
          key: n.path,
          'data-tag-path': n.path,
          'data-drop-target': drag.over && drag.over.path === n.path ? drag.over.zone : undefined,
          onDragStart: (e: React.DragEvent) => drag.rowEvents.onDragStartRow(e, n),
          onDragEnd: drag.rowEvents.onDragEnd,
          onDragOver: (e: React.DragEvent) => drag.rowEvents.onDragOverRow(e, n),
          onDragLeave: drag.bandEvents.onDragLeaveBand,
          onDrop: (e: React.DragEvent) => drag.rowEvents.onDropRow(e, n),
        })
      ),
      visible.slice(1).map((next) => {
        const prev = visible[visible.indexOf(next) - 1];
        const halves = bandHalves(prev, next);
        return createElement(
          'div',
          { key: 'band-' + next.path },
          Object.entries({ upper: halves.upper, lower: halves.lower }).map(([side, s]) =>
            s === null ? null : bandSide(side, s)
          )
        );
      })
    ),
    createElement('div', {
      'data-testid': 'root',
      onDragOver: drag.rootEvents.onDragOverRoot,
      onDrop: drag.rootEvents.onDropRoot,
    }),
    createElement(
      'span',
      { 'data-testid': 'meta' },
      `${drag.dragging}|${drag.sourcePath ?? ''}|${drag.rootAllowed}|${drag.overRoot}`
    )
  );
}

export interface MountedDrag {
  host: HTMLDivElement;
  onMoved: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
  onAutoExpand: ReturnType<typeof vi.fn>;
  fire: (el: Element, type: string, x?: number, y?: number) => void;
  row: (path: string) => Element;
  band: (value: string) => Element;
  root: () => Element;
  over: () => string;
  meta: () => string;
  startDrag: (path?: string) => void;
  settled: () => Promise<void>;
  /** 推进计时器并刷新 DOM(act 包裹,否则 setState 不会落到 DOM) */
  advance: (ms: number) => void;
  /** 窗口 pointerup:拖拽被打断的兜底路径 */
  pointerUp: () => void;
  unmount: () => void;
}

/** 挂载夹具:返回查询/派发帮手(测试文件负责 fake timers 与 rAF 桩) */
export function mountDrag(): MountedDrag {
  let data: FakeDt = fakeDt();
  const onMoved = vi.fn();
  const onError = vi.fn();
  const onAutoExpand = vi.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  act(() => root.render(createElement(Harness, { onMoved, onError, onAutoExpand })));

  const fire = (el: Element, type: string, x = 10, y = 10): void => {
    act(() => el.dispatchEvent(dragEv(type, data, x, y)));
  };
  const row = (path: string): Element => host.querySelector(`[data-tag-path="${path}"]`) as Element;
  const over = (): string => {
    const el = host.querySelector('[data-drop-target]');
    return el ? `${el.getAttribute('data-tag-path')}:${el.getAttribute('data-drop-target')}` : '';
  };
  return {
    host,
    onMoved,
    onError,
    onAutoExpand,
    fire,
    row,
    band: (value) => host.querySelector(`[data-band="${value}"]`) as Element,
    root: () => host.querySelector('[data-testid="root"]') as Element,
    over,
    meta: () => host.querySelector('[data-testid="meta"]')?.textContent ?? '',
    startDrag: (path = '工作/项目B') => {
      data = fakeDt(); // 每次拖拽会话一份新 DataTransfer
      fire(row(path), 'dragstart');
    },
    settled: () => act(async () => void (await Promise.resolve())),
    advance: (ms) => act(() => void vi.advanceTimersByTime(ms)),
    pointerUp: () =>
      act(() => {
        window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
      }),
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}
