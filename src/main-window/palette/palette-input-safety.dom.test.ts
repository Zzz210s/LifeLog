// 键盘目标判定函数的边界(palette-target):可编辑目标 / 浮层内 / 该忽略哪些键。
// Task 7 删掉浮层外壳后,原先经真实浮层派发事件的三组用例(IME 组合 / 浮层外不双动作 /
// 焦点在 body 仍生效)随之删除;判定函数仍被 use-palette 的窗口级监听使用,故保留纯函数这组。
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isEditableTarget, isInsidePalette, shouldIgnoreKey } from './palette-target';

/** 在指定元素上派发真实 keydown 并返回该事件(判定函数读的是 event.target) */
function fire(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/** 带 data-floating 的容器 + 内部输入框(浮层内的判定标记) */
function floating(): HTMLElement {
  const box = document.createElement('div');
  box.setAttribute('data-floating', 'palette');
  box.appendChild(document.createElement('input'));
  document.body.appendChild(box);
  return box;
}

describe('目标判定函数(palette-target)', () => {
  it('可编辑 = input/textarea/contenteditable(含后代);浮层内 = 命中 data-floating', () => {
    const box = floating();
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    const plain = document.createElement('div');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    editable.appendChild(child);
    const locked = document.createElement('span');
    locked.setAttribute('contenteditable', 'false'); // 嵌套关闭可编辑
    editable.appendChild(locked);
    expect([input, area, editable, child, locked, plain].map((el) => isEditableTarget(el))).toEqual([
      true, true, true, true, false, false,
    ]);
    expect(isEditableTarget(null)).toBe(false);
    expect(isInsidePalette(box.querySelector('input'))).toBe(true);
    expect(isInsidePalette(box)).toBe(true);
    expect(isInsidePalette(plain)).toBe(false);
    expect(isInsidePalette(null)).toBe(false);
    box.remove();
  });

  it('shouldIgnoreKey:浮层外的可编辑目标除 Esc 外一律忽略,其余目标不忽略', () => {
    const box = floating();
    const area = document.createElement('textarea');
    const plain = document.createElement('div');
    expect(shouldIgnoreKey(fire(area, 'ArrowDown'))).toBe(true);
    expect(shouldIgnoreKey(fire(area, 'Escape'))).toBe(false);
    expect(shouldIgnoreKey(fire(plain, 'ArrowDown'))).toBe(false);
    expect(shouldIgnoreKey(fire(box.querySelector('input') as Element, 'ArrowDown'))).toBe(false);
    box.remove();
  });
});
