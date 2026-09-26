// @vitest-environment jsdom
/**
 * T3 改名门:带行内 md 的名字必须能提交(旧口径的名称字符集会拦下 `[ ] ( )`)——
 * 提交给后端的是**原始 md 名**,级联回报的新路径带父级前缀。
 * 空白 / `#` / `/` 仍被本地拦下,且不调后端。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagMenu } from './TagMenu';
import { buildTree } from './tag-tree';
import type { ManagedNode } from './tag-tree';

const { renameTag } = vi.hoisted(() => ({ renameTag: vi.fn() }));
vi.mock('../../shared/api', () => ({
  api: {
    renameTag,
    tagImpact: () => Promise.resolve({ tags: 0, notes: 0 }),
    listTagAliases: () => Promise.resolve([]),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MD_NAME = '[郴](chēn)州市';
const node = buildTree([{ id: 2, path: `地点/郴州市`, depth: 2, self_count: 1, subtree_count: 1 }] as never)[0]
  .children[0] as ManagedNode;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  renameTag.mockReset();
  renameTag.mockResolvedValue(undefined);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const item = (text: string): HTMLElement =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLElement;

/** 写回受控输入(走原生 setter + input 事件) */
function setName(value: string): HTMLInputElement {
  const input = host.querySelector('input[aria-label="新标签名"]') as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}

/** 打开重命名面板并写入新名字 */
function typeName(value: string): HTMLInputElement {
  act(() => item('重命名').click());
  return setName(value);
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

function render(): { onDone: ReturnType<typeof vi.fn> } {
  const onDone = vi.fn();
  act(() => {
    root.render(
      createElement(TagMenu, {
        node,
        x: 10,
        y: 10,
        tagRows: [{ id: 2, path: '地点/郴州市', depth: 2, self_count: 1, subtree_count: 1 }] as never,
        onClose: () => {},
        onDone,
      })
    );
  });
  return { onDone };
}

describe('T3 标签改名门:md 名字放行', () => {
  it('提交 md 名:后端收到原始 md 名,级联新路径带父级前缀', async () => {
    const { onDone } = render();
    typeName(MD_NAME);
    act(() => item('确定').click());
    await flush();
    expect(renameTag).toHaveBeenCalledWith(2, MD_NAME);
    expect(onDone).toHaveBeenCalledWith('已重命名标签', {
      from: '地点/郴州市',
      to: `地点/${MD_NAME}`,
    });
    expect(host.textContent).not.toContain('不合法');
  });

  it('空白 / # / / 仍被本地拦下,不调后端', () => {
    const { onDone } = render();
    act(() => item('重命名').click());
    for (const bad of ['郴 州', '郴#州', '郴/州']) {
      setName(bad);
      act(() => item('确定').click());
      expect(host.textContent, bad).toContain('标签名不合法');
      expect(renameTag).not.toHaveBeenCalled();
    }
    expect(onDone).not.toHaveBeenCalled();
  });
});
