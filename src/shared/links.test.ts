// @vitest-environment jsdom
// jsdom:linkHrefFrom 依赖真实 DOM 的 closest/Element
import { describe, expect, it, vi } from 'vitest';

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));

import { linkHrefFrom, openExternal } from './links';

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

describe('linkHrefFrom', () => {
  it('点击 a 本身返回 href', () => {
    const el = mount('<a href="https://example.com">外链</a>').querySelector('a');
    expect(linkHrefFrom(el)).toBe('https://example.com');
  });

  it('点击 a 内部子元素也能上溯到链接', () => {
    const el = mount('<a href="https://example.com"><span id="s">外链</span></a>');
    expect(linkHrefFrom(el.querySelector('#s'))).toBe('https://example.com');
  });

  it('非链接元素返回 null', () => {
    const el = mount('<p id="p">普通文本</p>');
    expect(linkHrefFrom(el.querySelector('#p'))).toBeNull();
  });

  it('无 href 的 a 不算可导航链接', () => {
    const el = mount('<a id="a">锚点</a>');
    expect(linkHrefFrom(el.querySelector('#a'))).toBeNull();
  });

  it('null / 非 Element 目标安全返回 null', () => {
    expect(linkHrefFrom(null)).toBeNull();
    expect(linkHrefFrom({} as EventTarget)).toBeNull();
  });
});

describe('openExternal', () => {
  it('成功时不打扰调用方', async () => {
    openUrl.mockResolvedValueOnce(undefined);
    const onError = vi.fn();
    await openExternal('https://example.com', onError);
    expect(onError).not.toHaveBeenCalled();
  });

  it('失败时把可读消息交给调用方(不再只 console.warn)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    openUrl.mockRejectedValueOnce(new Error('boom'));
    const onError = vi.fn();
    await openExternal('https://example.com', onError);
    expect(onError).toHaveBeenCalledWith('无法打开链接: https://example.com');
    warn.mockRestore();
  });

  it('未提供回调时静默降级(不抛、不回退默认导航)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    openUrl.mockRejectedValueOnce(new Error('boom'));
    await expect(openExternal('https://example.com')).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
