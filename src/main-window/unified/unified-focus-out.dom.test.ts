// @vitest-environment jsdom
/**
 * 候选下拉的关闭手势(计划 3/3 Task 3):焦点离开整个输入区就关。
 *
 * 从 `unified-input.dom.test.ts` 拆出来(那个文件已 193 行,加两条就破 200 行红线)。
 * 这一对用例守的是同一个 hook 的两个方向:离开就关、点候选行不关。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { UnifiedInput } from './UnifiedInput';
import type { PaletteController } from '../palette/use-palette';
import type { ListRow } from '../../shared/quickpick/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../shared/api', () => ({ api: { saveInputNote: vi.fn(async () => 1) } }));

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const rows = (n: number): ListRow[] =>
  Array.from({ length: n }, (_, i) => ({
    item: { id: `t${i}`, label: `标签${i}` },
    score: 1,
    ranges: [],
    positions: [],
    pinned: false,
    mruCount: 0,
  }));

const stubPalette = (over: Partial<PaletteController> = {}): PaletteController => ({
  prefix: '', query: '', rows: [], total: 0, truncated: false, activeIndex: 0,
  setQuery: () => {}, setPrefix: () => {}, setActiveIndex: () => {}, ...over,
});

/** 挂上带候选的统一输入框,并在框里打出前缀让下拉出来 */
async function openWithDropdown(): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      createElement(UnifiedInput, {
        onSaved: () => {},
        editing: false,
        candidates: { palette: stubPalette({ rows: rows(3), total: 3 }) },
      })
    )
  );
  const box = host.querySelector('[data-testid="unified-input"]') as HTMLTextAreaElement;
  await act(async () => {
    box.focus(); // 真实流程:先在框里打字(焦点在框内),再点到别处
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(box, '#购');
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(host.querySelector('[data-testid="unified-dropdown"]')).not.toBeNull();
  return host;
}

const dropdown = (host: HTMLElement) => host.querySelector('[data-testid="unified-dropdown"]');
/** 关闭被推迟到下一帧(见 use-close-on-focus-out):等一帧再断言 */
const nextFrame = async () => {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
};

describe('候选下拉的焦点手势', () => {
  it('焦点离开输入区(点到框外)即关下拉', async () => {
    const host = await openWithDropdown();
    const outside = document.createElement('button');
    document.body.append(outside);
    await act(async () => outside.focus()); // 真实焦点转移 -> focusout 冒泡到容器
    await nextFrame();
    expect(dropdown(host)).toBeNull();
    expect((host.querySelector('[data-testid="unified-input"]') as HTMLTextAreaElement).value).toBe('#购');
  });

  it('焦点移到下拉内部(点候选行)不关', async () => {
    const host = await openWithDropdown();
    const option = host.querySelector('[role="option"]') as HTMLElement;
    option.tabIndex = 0; // 生产里行不可聚焦(见下),这里造一个焦点目标来验 contains 守卫
    await act(async () => option.focus());
    await nextFrame();
    expect(dropdown(host)).not.toBeNull();
  });

  it('候选行的 mousedown 仍然 preventDefault(关闭手势依赖这条保证)', async () => {
    // 本 hook 的"点候选行不关"靠两条:relatedTarget 在容器内,以及 PaletteRow 的 mousedown
    // 不让焦点离开输入框(压根不触发 focusout)。后者被删掉的话,焦点会落到 body -> 下拉在
    // mousedown 阶段被卸载 -> click 落在已移除的节点上,点击直接落空。所以把它钉在这里。
    const host = await openWithDropdown();
    const option = host.querySelector('[role="option"]') as HTMLElement;
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    await act(async () => option.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
  });

  it('焦点在同一帧内回到输入区 -> 撤销挂起的关闭(刚开的下拉不被上一帧的 blur 关掉)', async () => {
    const host = await openWithDropdown();
    const outside = document.createElement('button');
    document.body.append(outside);
    await act(async () => outside.focus()); // 挂起一次关闭
    const box = host.querySelector('[data-testid="unified-input"]') as HTMLTextAreaElement;
    await act(async () => box.focus()); // 焦点又回来(真实场景:点「筛选标签」把 # 预填进来)
    await nextFrame();
    expect(dropdown(host)).not.toBeNull();
  });

  it('关闭被推迟到下一帧:同一帧内不会因为位移而吞掉点击', async () => {
    const host = await openWithDropdown();
    const outside = document.createElement('button');
    document.body.append(outside);
    await act(async () => outside.focus());
    // 尚未过帧:下拉还在 —— 这正是"点下方条件栏时点击不被吃掉"的保证
    expect(dropdown(host)).not.toBeNull();
    await nextFrame();
    expect(dropdown(host)).toBeNull();
  });
});
