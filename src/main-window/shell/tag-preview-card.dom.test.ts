// @vitest-environment jsdom
/**
 * open 模式的流首预览卡片(设计 2026-10-16 §5.4):只放路径 + 两个计数 + 两个按钮,
 * 不拉笔记列表、零新 IPC。卡片不抢焦点(autoFocus 会打断滚动与阅读)。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TagPreviewCard } from './TagPreviewCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let onlyCalls: number;
let closeCalls: number;

beforeEach(() => {
  onlyCalls = 0;
  closeCalls = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = async (path = '读书/技术', self = 4, subtree = 9): Promise<void> => {
  await act(async () =>
    root.render(
      createElement(TagPreviewCard, {
        path,
        selfCount: self,
        subtreeCount: subtree,
        onOnlyThis: () => {
          onlyCalls += 1;
        },
        onClose: () => {
          closeCalls += 1;
        },
      })
    )
  );
};

const byLabel = (label: string): HTMLButtonElement =>
  host.querySelector('button[aria-label="' + label + '"]') as HTMLButtonElement;

describe('信息流:open 模式的预览卡片', () => {
  it('锚点:id 与 data-testid 都是 tag-preview-card,aria-label 带路径', async () => {
    await render('读书/技术');
    const card = host.querySelector('[data-testid="tag-preview-card"]');
    expect(card).not.toBeNull();
    expect(card!.id).toBe('tag-preview-card');
    expect(card!.getAttribute('aria-label')).toBe('实体预览：读书/技术');
  });

  it('文本:路径 + 本级/含子级两个计数 +「预览中」标记', async () => {
    await render('读书/技术', 4, 9);
    const text = host.textContent ?? '';
    expect(text).toContain('预览中');
    expect(text).toContain('读书/技术');
    expect(text).toContain('本级 4 条');
    expect(text).toContain('含子级 9 条');
  });

  it('「只看这条」与「关闭」各回调一次', async () => {
    await render();
    await act(async () => byLabel('只看这条').click());
    expect(onlyCalls).toBe(1);
    expect(closeCalls).toBe(0);
    await act(async () => byLabel('关闭').click());
    expect(closeCalls).toBe(1);
    expect(onlyCalls).toBe(1);
  });

  it('不 autoFocus:渲染后焦点不落在卡片内任何元素上', async () => {
    await render();
    expect(host.querySelectorAll('[autofocus]')).toHaveLength(0);
    expect(document.activeElement).toBe(document.body);
  });
});
