// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusWhenPresent } from './focus-when-present';

/** 用可控的 rAF 队列驱动重试,不依赖jsdom 的真实帧 */
function queueRaf(): Array<() => void> {
  const queue: Array<() => void> = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queue.push(() => cb(0));
    return queue.length;
  });
  return queue;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('focusWhenPresent:等元素出现再聚焦', () => {
  it('元素已在时立刻聚焦,不排帧', () => {
    const queue = queueRaf();
    const b = document.createElement('button');
    b.setAttribute('data-x', '');
    document.body.appendChild(b);
    focusWhenPresent('[data-x]');
    expect(queue).toHaveLength(0);
    expect(document.activeElement).toBe(b);
  });

  it('元素晚两帧出现 -> 逐帧重试后聚焦', () => {
    const queue = queueRaf();
    const b = document.createElement('button');
    b.id = 'later';
    focusWhenPresent('#later'); // 第 0 帧:没找到 -> 排一帧
    expect(queue.length).toBe(1);
    queue.shift()!(); // 第 1 帧:仍没找到 -> 再排一帧
    expect(queue.length).toBe(1);
    document.body.appendChild(b); // 第 2 帧前出现
    queue.shift()!();
    expect(document.activeElement).toBe(b);
    expect(queue).toHaveLength(0);
  });

  it('元素永远不出现 -> 重试耗尽后安静结束(不抛)', () => {
    const queue = queueRaf();
    focusWhenPresent('#nope', 2);
    expect(queue.length).toBe(1);
    queue.shift()!();
    queue.shift()!();
    expect(queue).toHaveLength(0);
  });
});
