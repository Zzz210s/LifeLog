/**
 * 输入栏补全两套 DOM 用例的共享夹具(仅测试引用):真 textarea + 真 `useInputCompletions`
 * (路由里标签/链接两套都在跑),输入走原型 value setter + input 事件 —— 让 React 的 onChange
 * 与 hook 里的元素级监听都真的触发(与真机打字同路径),只桩 IPC。
 *
 * 抽出来的理由与 `graph/canvas-test-kit.ts` 同:两份用例文件都要这套「挂载 / 键入 / 按键 / 读行」,
 * 复制一份既容易漂移又会顶破 200 行红线。
 */
import { act, createElement, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode, SyntheticEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useInputCompletions } from './use-input-completions';

const SET_VALUE = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;

/** 宿主接线的最小复刻:非受控 textarea + 值/光标镜像 + 采纳写回(与 InputBar.applyValue 同形) */
function Harness(): ReactNode {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');
  const [caret, setCaret] = useState(0);
  const apply = (next: string) => {
    const el = ref.current;
    if (el !== null) {
      el.value = next;
      el.setSelectionRange(next.length, next.length);
    }
    setValue(next);
    setCaret(next.length);
  };
  const c = useInputCompletions({ textareaRef: ref, value, caret, onReplace: apply });
  return createElement(
    'div',
    null,
    createElement('textarea', {
      ref,
      defaultValue: '',
      'aria-label': '输入栏内容',
      onChange: (e: ChangeEvent<HTMLTextAreaElement>) => {
        setValue(e.target.value);
        setCaret(e.target.selectionStart ?? 0);
      },
      onSelect: (e: SyntheticEvent<HTMLTextAreaElement>) => setCaret(e.currentTarget.selectionStart ?? 0),
      onKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        c.onKeyDown(e);
      },
    }),
    c.list,
  );
}

export interface CompletionsDom {
  host: HTMLDivElement;
  box(): HTMLTextAreaElement;
  /** 模拟键入:改值 + 光标落末尾 + 派发 input */
  type(text: string): Promise<void>;
  /** 派发 keydown(可带 isComposing) */
  key(k: string, init?: KeyboardEventInit): Promise<void>;
  /** 派发只给 keyCode 229 的输入法 keydown(组合态的另一形态) */
  keyCode229(k: string): Promise<void>;
  /** 某个下拉(testid)里各行的可见文案 */
  labels(testid: string): string[];
  /** 某个下拉(testid)是否存在 */
  appears(testid: string): boolean;
  /** 某个下拉(testid)里 `<mark>` 的文本 */
  marks(testid: string): string[];
  /** 某个下拉(testid)里高亮行的下标(无则 -1) */
  selected(testid: string): number;
  unmount(): void;
}

export async function mountCompletions(): Promise<CompletionsDom> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  await act(async () => root.render(createElement(Harness)));

  const box = () => host.querySelector('textarea[aria-label="输入栏内容"]') as HTMLTextAreaElement;
  const settle = async (): Promise<void> => {
    await act(async () => {
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
  };
  const rows = (testid: string) =>
    Array.from(host.querySelectorAll(`[data-testid="${testid}"] button[role="option"]`));

  return {
    host,
    box,
    async type(text: string) {
      const el = box();
      await act(async () => {
        SET_VALUE.call(el, text);
        el.setSelectionRange(text.length, text.length);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await settle();
    },
    async key(k: string, init: KeyboardEventInit = {}) {
      await act(async () => {
        box().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
      });
      await settle();
    },
    async keyCode229(k: string) {
      await act(async () => {
        const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
        Object.defineProperty(e, 'keyCode', { get: () => 229 });
        box().dispatchEvent(e);
      });
      await settle();
    },
    labels: (testid) => rows(testid).map((b) => (b.textContent ?? '').trim()),
    appears: (testid) => host.querySelector(`[data-testid="${testid}"]`) !== null,
    marks: (testid) => Array.from(host.querySelectorAll(`[data-testid="${testid}"] mark`)).map((m) => m.textContent ?? ''),
    selected: (testid) => rows(testid).findIndex((b) => b.getAttribute('aria-selected') === 'true'),
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}
