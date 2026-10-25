// @vitest-environment jsdom
/**
 * 侧栏多选的纯逻辑(2026-10-25):单击切换、Shift 连选、Ctrl+A 全选、Esc 退出。
 * 只测 hook 本身(行渲染与浮条另有 DOM 用例),避免把三个职责揉进一个大用例。
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

describe('侧栏多选', () => {
  it('默认关闭且选中集为空', () => {
    expect(api!.active).toBe(false);
    expect(api!.count).toBe(0);
  });

  it('开启后单击切换该行,再点取消', () => {
    run(() => api!.setActive(true));
    run(() => api!.toggle('a/1'));
    expect([...api!.selected]).toEqual(['a/1']);
    run(() => api!.toggle('a/1'));
    expect(api!.count).toBe(0);
  });

  it('Shift 连选按可见顺序取区间,锚点不随后续 Shift 移动', () => {
    run(() => api!.setActive(true));
    run(() => api!.toggle('a/1')); // 锚点 = a/1
    run(() => api!.rangeTo('b', ORDER));
    expect([...api!.selected].sort()).toEqual(['a/1', 'a/2', 'b']);
    // 反方向拖区间:锚点仍是 a/1
    run(() => api!.rangeTo('a', ORDER));
    expect([...api!.selected].sort()).toEqual(['a', 'a/1']);
  });

  it('Ctrl+A 全选可见行,再按一次清空', () => {
    run(() => api!.setActive(true));
    run(() => api!.selectAll(ORDER));
    expect(api!.count).toBe(ORDER.length);
    run(() => api!.selectAll(ORDER));
    expect(api!.count).toBe(0);
  });

  it('Esc 退出多选并清空(这一下被多选吃掉,不会再关别的东西)', () => {
    run(() => api!.setActive(true));
    run(() => api!.toggle('b'));
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(api!.active).toBe(false);
    expect(api!.count).toBe(0);
  });

  it('关闭模式时 Ctrl+A 不拦输入框(焦点在 textarea 时走浏览器默认)', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    run(() => api!.setActive(true));
    act(() => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
    });
    expect(api!.count).toBe(0); // 输入框里的全选归它自己,选中集不动
    ta.remove();
  });
});
