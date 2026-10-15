// @vitest-environment jsdom
/**
 * 取值侧的组合守卫(用户报告 2026-10-15:拼音未上屏就被当成搜索/筛选词)。
 * 走**真实组合事件序列**(compositionstart -> input{isComposing} -> compositionupdate -> compositionend),
 * 断言三件事:
 *  ① 组合中 onStateChange 一次都不发(候选/`/` 筛选/防抖回写全在这条链上),
 *     且受控输入框照样显示原始拼音(组合中不能丢 onChange,否则「打不进字」);
 *  ② 上屏后恰好发一次,且用的是上屏文本;
 *  ③ `#` 模式的 query 同样冻结(候选列表据此驱动)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UnifiedInput } from './UnifiedInput';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../shared/api', () => ({ api: { saveInputNote: async () => 1 } }));

let root: Root | null = null;
const mount = async (props: Partial<Parameters<typeof UnifiedInput>[0]> = {}) => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(UnifiedInput, { onSaved: () => {}, editing: false, ...props })));
  return host;
};
const box = (host: HTMLElement) => host.querySelector('[data-testid="unified-input"]') as HTMLTextAreaElement;
const SET_VALUE = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;

/** 普通键入(非组合):改值 + 派发不带 isComposing 的 input */
const type = async (host: HTMLElement, text: string) => {
  const el = box(host);
  await act(async () => {
    SET_VALUE.call(el, text);
    el.setSelectionRange(text.length, text.length);
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
};

/** 组合中的一步:原始拼音已经进了 DOM,但还没上屏 */
const compose = async (host: HTMLElement, text: string) => {
  const el = box(host);
  await act(async () => {
    SET_VALUE.call(el, text);
    el.setSelectionRange(text.length, text.length);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: text }));
  });
};

/** 上屏:compositionend 带上最终文本(实测 WebView2 的 input 之后只有它,没有再补非组合 input) */
const commit = async (host: HTMLElement, text: string) => {
  const el = box(host);
  await act(async () => {
    SET_VALUE.call(el, text);
    el.setSelectionRange(text.length, text.length);
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }));
  });
};

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; });

describe('统一输入框:组合中的原始拼音不进下游', () => {
  it('组合中不发查询、不换模式,拼音照样显示在受控框里;上屏后才发一次且用上屏文本', async () => {
    const onStateChange = vi.fn();
    const host = await mount({ onStateChange });
    await type(host, '/');
    const before = onStateChange.mock.calls.length;
    expect(onStateChange).toHaveBeenLastCalledWith({ mode: 'filter', query: '', prefix: '/' });

    box(host).dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    for (const pinyin of ['/chen', '/cheng', '/chengping']) {
      await compose(host, pinyin);
      expect(box(host).value).toBe(pinyin); // ③ 受控框在组合中仍显示拼音(没被丢成打不进字)
      expect(onStateChange.mock.calls.length).toBe(before); // ① 组合中一次都不发
    }

    await commit(host, '/陈平');
    expect(box(host).value).toBe('/陈平');
    expect(onStateChange.mock.calls.length).toBe(before + 1); // ② 上屏后恰好一次
    expect(onStateChange).toHaveBeenLastCalledWith({ mode: 'filter', query: '陈平', prefix: '/' });
  });

  it('# 模式的 query 同样冻结:组合中候选仍按上屏前的词,上屏后才换成新词', async () => {
    const onStateChange = vi.fn();
    const host = await mount({ onStateChange });
    await type(host, '#工作');
    expect(onStateChange).toHaveBeenLastCalledWith({ mode: 'tag', query: '工作', prefix: '#' });

    await compose(host, '#工作cheng');
    expect(onStateChange).toHaveBeenLastCalledWith({ mode: 'tag', query: '工作', prefix: '#' }); // 冻结

    await commit(host, '#工作成都');
    expect(onStateChange).toHaveBeenLastCalledWith({ mode: 'tag', query: '工作成都', prefix: '#' });
  });

  it('上屏那一下还会补一次普通 input(真机顺序)时,下游仍只收到一次最终文本', async () => {
    const onStateChange = vi.fn();
    const host = await mount({ onStateChange });
    await type(host, '/');
    const before = onStateChange.mock.calls.length;
    await compose(host, '/chen');
    await commit(host, '/陈平');
    await type(host, '/陈平');
    expect(onStateChange.mock.calls.length).toBe(before + 1);
    expect(onStateChange).toHaveBeenLastCalledWith({ mode: 'filter', query: '陈平', prefix: '/' });
  });
});
