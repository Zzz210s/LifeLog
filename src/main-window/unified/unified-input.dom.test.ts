// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UnifiedInput } from './UnifiedInput';

// 仓库既有 dom 测试约定:显式声明 act 环境,避免 React 的 stderr 噪声
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 参数名带下划线:mock 自身不用它,但类型要能接受被调用时传的内容
const saveInputNote = vi.fn(async (_s: string) => 1);
vi.mock('../../shared/api', () => ({ api: { saveInputNote: (s: string) => saveInputNote(s) } }));

let root: Root | null = null;
const mount = async (props: Partial<Parameters<typeof UnifiedInput>[0]> = {}) => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(UnifiedInput, { onSaved: () => {}, editing: false, ...props })));
  return host;
};
const box = (host: HTMLElement) => host.querySelector('[data-testid="unified-input"]') as HTMLTextAreaElement;
const type = async (host: HTMLElement, text: string) => {
  const el = box(host);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => saveInputNote.mockClear());
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('唯一输入框(设计 §3/§4)', () => {
  it('渲染成 textarea 且带 aria-label 与 data-testid', async () => {
    const host = await mount();
    expect(box(host).tagName).toBe('TEXTAREA');
    expect(box(host).getAttribute('aria-label')).toBe('统一输入框');
  });

  it('记录模式 Ctrl+Enter 保存并清空', async () => {
    const host = await mount();
    await type(host, '买牛奶');
    await act(async () => {
      box(host).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    });
    expect(saveInputNote).toHaveBeenCalledWith('买牛奶');
    expect(box(host).value).toBe('');
  });

  it('编辑态只读:不保存、提示行换成编辑说明', async () => {
    const host = await mount({ editing: true });
    expect(box(host).disabled).toBe(true);
    expect(host.textContent).toContain('编辑中');
    await act(async () => {
      box(host).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    });
    expect(saveInputNote).not.toHaveBeenCalled();
  });

  it('记录模式不渲染下拉(设计 D6)', async () => {
    const host = await mount({ dropdown: createElement('div', { 'data-testid': 'fake-dropdown' }) });
    await type(host, '买牛奶');
    expect(host.querySelector('[data-testid="fake-dropdown"]')).toBeNull();
  });

  it('输入前缀时把模式上报给父组件', async () => {
    const seen: string[] = [];
    const host = await mount({ onStateChange: (s) => seen.push(s.mode) });
    await type(host, '#购');
    expect(seen.at(-1)).toBe('tag');
  });

  it('保存失败:内容保留并在框下给中文原因', async () => {
    saveInputNote.mockRejectedValueOnce(new Error('库锁住了'));
    const host = await mount();
    await type(host, '买牛奶');
    await act(async () => {
      box(host).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    });
    expect(box(host).value).toBe('买牛奶');
    expect(host.textContent).toContain('保存失败');
  });
});
