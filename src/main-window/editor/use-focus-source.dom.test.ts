// @vitest-environment jsdom
/**
 * 进编辑的光标落点(用户 2026-10-03):
 *   有 caretHint -> 落在点击位置;没有/越界 -> 退回正文末尾(末行 `#标签` 之前)。
 */
import { act, createElement, useRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useFocusSource } from './use-focus-source';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = '第一段正文\n\n第二段\n#日期/2026/10/03';

function Harness({ hint }: { hint?: number | null }): ReactNode {
  const box = useRef<HTMLTextAreaElement>(null);
  useFocusSource(box, undefined, hint);
  return createElement('textarea', { ref: box, defaultValue: SRC });
}

let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  host.remove();
});

const box = (): HTMLTextAreaElement => host.querySelector('textarea') as HTMLTextAreaElement;

describe('useFocusSource 的光标落点', () => {
  it('给了 caretHint:光标落在该偏移(不是末尾)', async () => {
    await act(async () => { root?.render(createElement(Harness, { hint: 3 })); });
    expect(box().selectionStart).toBe(3);
    expect(box().selectionStart).not.toBe(SRC.length);
  });

  it('没有 caretHint:退回正文末尾(末行标签之前)', async () => {
    await act(async () => { root?.render(createElement(Harness, { hint: null })); });
    expect(box().selectionStart).toBe(SRC.lastIndexOf('\n'));
  });

  it('caretHint 越界(超过正文末尾):退回末尾,不越进标签行', async () => {
    await act(async () => { root?.render(createElement(Harness, { hint: 9999 })); });
    expect(box().selectionStart).toBe(SRC.lastIndexOf('\n'));
  });
});
