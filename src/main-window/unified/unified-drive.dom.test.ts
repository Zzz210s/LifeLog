// @vitest-environment jsdom
/**
 * Task 5 的接线证据:统一输入框敲前缀 -> 候选控制器取候选 -> 下拉真出候选。
 * 这里挂的是**真** useAppPalette + 真 provider + 真 usePalette,只把数据层(api)换成桩,
 * 所以能钉住"常驻驱动"这条链(输入框自己不开浮层,也不复制一套 matcher)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { COMMANDS, withRuns } from '../../shared/commands';
import type { CommandRegistry } from '../../shared/commands';
import { defaultContext } from '../../shared/keys';
import type { Note, TagCount } from '../../shared/types';
import { useAppPalette } from '../shell/use-app-palette';
import { UnifiedInput } from './UnifiedInput';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { queryNotes, listTags, getSetting, setSetting } = vi.hoisted(() => ({
  queryNotes: vi.fn(async () => [] as Note[]),
  listTags: vi.fn(async () => [] as TagCount[]),
  getSetting: vi.fn(async (_key: string): Promise<string | null> => null),
  setSetting: vi.fn(async () => {}),
}));
vi.mock('../../shared/api', () => ({ api: { queryNotes, listTags, getSetting, setSetting } }));

const tag = (path: string, subtree: number): TagCount => ({
  id: path.length, path, depth: 0, sort_order: 0, self_count: subtree, subtree_count: subtree,
});

let root: Root | null = null;
let host: HTMLDivElement;
const registry: CommandRegistry = withRuns(
  COMMANDS,
  Object.fromEntries(COMMANDS.all.map((c) => [c.id, () => {}])),
);

function Host(): ReactNode {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [tagsVersion] = useState(0);
  const palette = useAppPalette({
    registry,
    getContext: () => defaultContext(),
    tagsVersion,
    setError: () => {},
  });
  return createElement(
    'div',
    { ref: anchorRef },
    createElement(UnifiedInput, {
      onSaved: () => {},
      editing: false,
      candidates: {
        palette: palette.controller,
        decorations: palette.decorations,
        refreshKey: tagsVersion,
        onError: () => {},
      },
    }),
  );
}

const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });
};
const box = () => host.querySelector('[data-testid="unified-input"]') as HTMLTextAreaElement;
const type = async (text: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(box(), text);
    box().dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
};
const drop = () => host.querySelector('[data-testid="unified-dropdown"]');

beforeEach(async () => {
  queryNotes.mockResolvedValue([{ id: 1, content: '买牛奶', created_at: '2026-09-22 10:00:00', tags: ['生活'] }]);
  listTags.mockResolvedValue([tag('工作/项目A', 4), tag('生活', 1)]);
  getSetting.mockResolvedValue(null);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Host)));
  await settle(); // 设置读回(usePaletteSettings)也是异步的:先让它落地再操作
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('统一输入框 -> 候选控制器 -> 候选下拉(常驻驱动)', () => {
  it('`#` 输入后下拉出现标签候选(数据来自 list_tags)', async () => {
    await type('#工作');
    expect(listTags).toHaveBeenCalled();
    expect(drop()).not.toBeNull();
    expect(drop()!.textContent).toContain('工作/项目A');
  });

  it('`@` 输入后下拉出现笔记候选(走 @ 前缀的笔记 provider)', async () => {
    await type('@牛奶');
    expect(queryNotes).toHaveBeenCalled();
    expect(drop()!.textContent).toContain('买牛奶');
  });

  it('`>` 输入后下拉出现命令候选', async () => {
    await type('>侧栏');
    expect(drop()!.textContent).toContain('隐藏侧栏');
  });

  it('方向键能移动高亮(驱动去重:上游 setter 换身份不得把高亮按回第一行)', async () => {
    await type('#'); // 两个标签都命中,才有第二行可移
    const selected = () =>
      Array.from(drop()!.querySelectorAll('li[role="option"]')).findIndex((li) => li.getAttribute('aria-selected') === 'true');
    expect(selected()).toBe(0);
    await act(async () => {
      box().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    });
    await settle();
    expect(selected()).toBe(1);
  });

  it('记录模式与 `/` 筛选不出现下拉(控制器不再有浮层开合态)', async () => {
    await type('买牛奶');
    expect(drop()).toBeNull();
    await type('/买牛奶');
    expect(drop()).toBeNull();
    expect(host.querySelector('[data-hidden="false"]')).toBeNull();
    expect(queryNotes).not.toHaveBeenCalled(); // 记录/筛选模式不驱动取候选
  });

  it('退出前缀模式后停掉后台取候选(前缀清空,列表随之消失)', async () => {
    await type('#工作');
    expect(drop()).not.toBeNull();
    await type('买牛奶 #工作');
    expect(drop()).toBeNull();
    await type('');
    await settle();
    expect(drop()).toBeNull();
  });
});
