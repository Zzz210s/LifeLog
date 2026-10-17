// @vitest-environment jsdom
/**
 * 批量标签输入(spec 2026-10-17 §4.1/§4.2):候选走与统一输入框同一引擎的树内档;
 * 目标必须命中**已有标签**的完整路径,否则报「标签不存在」且不发 IPC。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchTagInput } from './BatchTagInput';

const { completeNotes, listTags } = vi.hoisted(() => ({
  completeNotes: vi.fn(async () => [{ id: 10, title: '工作' }]),
  listTags: vi.fn(async () => [
    { id: 10, path: '工作', depth: 1, sort_order: 0, self_count: 0, subtree_count: 0 },
  ]),
}));
vi.mock('../../shared/api', () => ({ api: { completeNotes, listTags } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let add: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;

const mount = async (disabled = false): Promise<void> => {
  await act(async () => {
    root.render(
      createElement(BatchTagInput, {
        disabled,
        dataVersion: 0,
        add: add as unknown as (t: number, l: string) => void,
        remove: remove as unknown as (t: number, l: string) => void,
      })
    );
  });
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
};

const input = (): HTMLInputElement =>
  host.querySelector('[data-testid="batch-tag-input"]') as HTMLInputElement;
const btn = (id: string): HTMLButtonElement =>
  host.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;
const click = (el: Element): Promise<void> =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });

/** React 受控 input:必须走原生 setter + input 事件,直接改 .value 不触发 onChange */
const type = async (text: string): Promise<void> => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input(), text);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  add = vi.fn();
  remove = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe('批量标签输入', () => {
  it('输入前缀出候选(与统一输入框同一树内档)', async () => {
    await mount();
    await type('工');
    const rows = host.querySelectorAll('[data-testid="batch-tag-candidate"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toBe('工作');
  });

  it('点候选填入完整路径,加标签按实体 id 调用', async () => {
    await mount();
    await type('工作');
    await click(host.querySelector('[data-testid="batch-tag-candidate"]')!);
    expect(input().value).toBe('工作');
    await click(btn('batch-tag-add'));
    expect(add).toHaveBeenCalledWith(10, '工作');
  });

  it('去标签走同一个解析(同一目标、不同动作)', async () => {
    await mount();
    await type('工作');
    await click(btn('batch-tag-remove'));
    expect(remove).toHaveBeenCalledWith(10, '工作');
    expect(add).not.toHaveBeenCalled();
  });

  it('未命中的输入:报「标签不存在」且不发 IPC、输入还在', async () => {
    await mount();
    await type('没这个标签');
    await click(btn('batch-tag-add'));
    expect(host.querySelector('[data-testid="batch-tag-error"]')!.textContent).toContain(
      '标签不存在'
    );
    expect(add).not.toHaveBeenCalled();
    expect(input().value).toBe('没这个标签');
  });

  it('Enter 等于加标签', async () => {
    await mount();
    await type('工作');
    await act(async () => {
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(add).toHaveBeenCalledWith(10, '工作');
  });

  it('禁用态(0 选)下两个按钮不可点', async () => {
    await mount(true);
    expect(btn('batch-tag-add').disabled).toBe(true);
    expect(btn('batch-tag-remove').disabled).toBe(true);
  });
});
