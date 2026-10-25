// @vitest-environment jsdom
/**
 * 侧栏选择(VS Code 口径,2026-10-25 第二版):单击单选、Ctrl 加选、Shift 连选、Ctrl+A、Esc。
 * 只测 hook 的纯逻辑;行高亮与浮条另有 DOM 用例。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTagSelection, type TagSelectionApi } from './use-tag-selection';

let host: HTMLDivElement;
let root: Root | null = null;
let api: TagSelectionApi | null = null;

const ORDER = ['a', 'a/1', 'a/2', 'b', 'b/1'];

function Probe(): null {
  api = useTagSelection(ORDER);
  return null;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Probe)));
});

afterEach(() => {
  act(() => root?.unmount());
  host.remove();
  root = null;
  api = null;
});

const run = (fn: () => void): void => {
  act(() => fn());
};

describe('侧栏选择', () => {
  it('初始为空', () => {
    expect(api!.count).toBe(0);
  });

  it('单击 = 替换为仅这一行(VS Code 的单选)', () => {
    run(() => api!.selectOnly('a/1'));
    expect([...api!.selected]).toEqual(['a/1']);
    run(() => api!.selectOnly('b'));
    expect([...api!.selected]).toEqual(['b']); // 不是累加
  });

  it('Ctrl+单击 = 加选 / 减选', () => {
    run(() => api!.selectOnly('a'));
    run(() => api!.toggle('a/2'));
    run(() => api!.toggle('b/1'));
    expect([...api!.selected].sort()).toEqual(['a', 'a/2', 'b/1']);
    run(() => api!.toggle('a/2'));
    expect([...api!.selected].sort()).toEqual(['a', 'b/1']);
  });

  it('Shift+单击 = 从锚点连选,锚点不随 Shift 移动', () => {
    run(() => api!.selectOnly('a/1')); // 锚点 = a/1
    run(() => api!.rangeTo('b'));
    expect([...api!.selected].sort()).toEqual(['a/1', 'a/2', 'b']);
    run(() => api!.rangeTo('a')); // 反向伸缩,锚点仍是 a/1
    expect([...api!.selected].sort()).toEqual(['a', 'a/1']);
  });

  it('没有锚点时 Shift 只选这一行(刚启动就 Shift 不炸)', () => {
    run(() => api!.rangeTo('a/2'));
    expect([...api!.selected]).toEqual(['a/2']);
  });

  it('Ctrl+A 全选可见行,再按一次清空', () => {
    run(() => api!.selectAll());
    expect(api!.count).toBe(ORDER.length);
    run(() => api!.selectAll());
    expect(api!.count).toBe(0);
  });

  it('Ctrl+A 的键盘入口:焦点在 textarea 时不拦', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    act(() => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
    });
    expect(api!.count).toBe(0);
    ta.remove();
  });

  it('Esc 清空选择(没有选择时不拦,归别的组件处理)', () => {
    run(() => api!.selectOnly('b'));
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(api!.count).toBe(0);
  });

  it('可见行里消失的路径从选择集摘掉(删/改名后不留悬空)', () => {
    run(() => api!.selectOnly('a'));
    run(() => api!.toggle('b/1'));
    // 模拟 b/1 已被删除:重新挂一个可见集更小的实例
    act(() => root!.unmount());
    root = createRoot(host);
    act(() => root!.render(createElement(Probe)));
    expect(api!.count).toBe(0);
  });
});
