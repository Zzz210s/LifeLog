// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PrefixHint } from './PrefixHint';

// 仓库既有 dom 测试约定:显式声明 act 环境,避免 React 的 stderr 噪声
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const mount = async (props: Parameters<typeof PrefixHint>[0]) => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(PrefixHint, props)));
  return host;
};
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; });

describe('前缀提示行(设计 §3.1)', () => {
  it('空闲态:四段提示按固定顺序出现,且都可点', async () => {
    const onPickPrefix = vi.fn();
    const host = await mount({ mode: 'note', onPickPrefix });
    const text = host.textContent ?? '';
    expect(text).toContain('命令');
    expect(text).toContain('筛选');
    expect(text).toContain('标签筛选');
    expect(text).toContain('打开笔记');
    expect(host.querySelectorAll('[data-prefix]').length).toBe(4);
  });

  it('点某段:把该前缀回传给上层', async () => {
    const onPickPrefix = vi.fn();
    const host = await mount({ mode: 'note', onPickPrefix });
    const btn = host.querySelector('[data-prefix="#"]') as HTMLElement;
    await act(async () => btn.click());
    expect(onPickPrefix).toHaveBeenCalledWith('#');
  });

  it('有前缀:该段高亮 + 显示实时统计', async () => {
    const host = await mount({ mode: 'tag', stat: '12 个匹配', onPickPrefix: () => {} });
    expect(host.textContent).toContain('12 个匹配');
    const active = host.querySelector('[data-prefix="#"]') as HTMLElement;
    expect(active.getAttribute('data-active')).toBe('true');
  });

  it('编辑态:整行换成只读说明,不再显示前缀入口', async () => {
    const host = await mount({ mode: 'note', readonly: true, onPickPrefix: () => {} });
    expect(host.textContent).toContain('编辑中');
    expect(host.querySelectorAll('[data-prefix]').length).toBe(0);
  });

  it('错误态:整行换成错误文案,优先级高于编辑只读', async () => {
    const host = await mount({
      mode: 'note',
      readonly: true,
      error: '保存失败: 库锁住了',
      onPickPrefix: () => {},
    });
    expect(host.textContent).toContain('保存失败: 库锁住了');
    expect(host.textContent).not.toContain('编辑中');
    expect(host.querySelectorAll('[data-prefix]').length).toBe(0);
  });
});
