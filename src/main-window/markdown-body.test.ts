// @vitest-environment jsdom
// 交互层证据:读视图复选框点击 -> 回调序号(索引取自 data-task-index,不数 DOM 顺序)
import { createElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { renderMarkdown, renderMarkdownInteractive } from '../shared/markdown';
import { MarkdownBody } from './MarkdownBody';

// react-dom 的 act 需要这个全局标记(Vitest 无内置 RTL 配置)
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DOC = '- [ ] 一\n- [x] 二';

async function mount(node: ReturnType<typeof createElement>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return container;
}

/** 真实指针点击是可取消事件:必须 cancelable,否则 preventDefault 不生效 */
function click(el: Element): Promise<void> {
  return act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('MarkdownBody 交互态任务复选框', () => {
  it('按 data-task-index 回调对应序号,并取消原生勾选态', async () => {
    const calls: number[] = [];
    const container = await mount(
      createElement(MarkdownBody, {
        html: renderMarkdownInteractive(DOC),
        className: 'md-body',
        interactive: true,
        onToggleTask: (i: number) => calls.push(i),
      })
    );
    const boxes = container.querySelectorAll('input[type="checkbox"]');
    expect(boxes.length).toBe(2);
    await click(boxes[1]);
    await click(boxes[0]);
    expect(calls).toEqual([1, 0]);
    // 勾选态以正文为准:原生那次翻转被 preventDefault 拦下(等改写后的正文回来再重渲)
    expect((boxes[0] as HTMLInputElement).checked).toBe(false);
    expect((boxes[1] as HTMLInputElement).checked).toBe(true);
  });

  it('默认(只读)态点击不回调:编辑预览路径不受影响', async () => {
    const calls: number[] = [];
    const container = await mount(
      createElement(MarkdownBody, {
        html: renderMarkdownInteractive(DOC),
        className: 'md-body',
        onToggleTask: (i: number) => calls.push(i),
      })
    );
    await click(container.querySelectorAll('input[type="checkbox"]')[0]);
    expect(calls).toEqual([]);
  });

  it('只读渲染产物无序号标记,点击自然无效果', async () => {
    const calls: number[] = [];
    const container = await mount(
      createElement(MarkdownBody, {
        html: renderMarkdown(DOC),
        className: 'md-body',
        interactive: true,
        onToggleTask: (i: number) => calls.push(i),
      })
    );
    const box = container.querySelectorAll('input[type="checkbox"]')[0];
    expect(box.getAttribute('data-task-index')).toBeNull();
    expect((box as HTMLInputElement).disabled).toBe(true);
    expect(calls).toEqual([]);
  });
});
