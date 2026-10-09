// @vitest-environment jsdom
/**
 * 关系面板的加载态与鼠标采纳细节(自 tag-menu-relation.dom.test.ts 抽出,守 200 行上限):
 * 读取未回来时禁用输入与候选、Enter 不写库;查询无命中给空态;候选 mousedown 采纳并 preventDefault。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelationRef, TagCount } from '../../shared/types';
import { TagMenuRelationPane } from './TagMenuRelationPane';

const { listTagRelations, setTagRelation, removeTagRelation } = vi.hoisted(() => ({
  listTagRelations: vi.fn(),
  setTagRelation: vi.fn(),
  removeTagRelation: vi.fn(),
}));
vi.mock('../../shared/api', () => ({ api: { listTagRelations, setTagRelation, removeTagRelation } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const at = (id: number, path: string): TagCount => ({
  id,
  path,
  depth: 1,
  sort_order: id,
  self_count: 0,
  subtree_count: 0,
});
const SELF = at(1, '关系测试甲');
const OTHER = at(3, '关系测试丙');
const ROWS = [SELF, OTHER];
const EDGES: RelationRef[] = [{ toTagId: 2, path: '关系测试乙', name: '关系测试乙', remark: '' }];

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  listTagRelations.mockReset();
  setTagRelation.mockReset();
  removeTagRelation.mockReset();
  listTagRelations.mockResolvedValue(EDGES);
  setTagRelation.mockResolvedValue(undefined);
  removeTagRelation.mockResolvedValue(undefined);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

const renderPane = (): void => {
  act(() => {
    root.render(
      createElement(TagMenuRelationPane, {
        tagId: 1,
        path: '关系测试甲',
        rows: ROWS,
        onCancel: () => {},
      })
    );
  });
};

const paneInput = (): HTMLInputElement =>
  host.querySelector('input[aria-label="添加引用目标"]') as HTMLInputElement;
const candidateTexts = (): string[] =>
  [...host.querySelectorAll('[data-relation-candidate]')].map((el) => el.textContent?.trim() ?? '');

const typeQuery = (v: string): void => setInput(paneInput(), v);

/** React 受控输入必须用原生 setter + input 事件,直接改 value 不触发 onChange */
function setInput(el: HTMLInputElement, v: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setValue?.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 属性名输入框(边上的 remark;可空 = 只声明有关系,R12) */
const remarkInput = (): HTMLInputElement =>
  host.querySelector('input[aria-label="引用属性名"]') as HTMLInputElement;

describe('关系面板·加载与交互细节', () => {
  it('读取未回来时输入禁用,Enter 不会写库', async () => {
    listTagRelations.mockReturnValue(new Promise(() => {}));
    renderPane();
    expect(paneInput().disabled).toBe(true);
    expect(host.textContent).toContain('加载中');
    act(() =>
      paneInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    );
    await flush();
    expect(setTagRelation).not.toHaveBeenCalled();
  });

  it('「当前引用」标题恰好渲染一次;空关系给空态文案', async () => {
    listTagRelations.mockResolvedValue([]);
    renderPane();
    await flush();
    const headings = [...host.querySelectorAll('p')].filter((el) => el.textContent === '当前引用');
    expect(headings).toHaveLength(1);
    expect(host.textContent).toContain('还没有建立任何引用');
  });

  it('查询无命中时给空态文案', async () => {
    renderPane();
    await flush();
    typeQuery('zzzz');
    expect(candidateTexts().length).toBe(0);
    expect(host.textContent).toContain('没有匹配的实体');
  });

  it('候选用 mousedown 采纳并 preventDefault(输入框不失焦)', async () => {
    renderPane();
    await flush();
    const button = host.querySelector('[data-relation-candidate]') as HTMLElement;
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => button.dispatchEvent(ev));
    await flush();
    expect(ev.defaultPrevented).toBe(true);
    expect(setTagRelation).toHaveBeenCalledWith(1, OTHER.id, '');
  });

  it('属性名输入框:填写的属性名随边一起写入', async () => {
    renderPane();
    await flush();
    expect(remarkInput().disabled).toBe(false);
    setInput(remarkInput(), '国籍');
    act(() => paneInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await flush();
    expect(setTagRelation).toHaveBeenCalledWith(1, OTHER.id, '国籍');
  });

  it('当前引用行可编辑属性名:失焦提交 upsert', async () => {
    listTagRelations.mockResolvedValue([
      { toTagId: 2, path: '地点/日本', name: '日本', remark: '国籍' },
    ]);
    renderPane();
    await flush();
    const row = host.querySelector('input[data-relation-remark="2"]') as HTMLInputElement;
    expect(row.value).toBe('国籍');
    setInput(row, '出生地');
    // React 17+ 的 onBlur 实际监听 focusout:派发 'blur' 不会触发 onBlur
    act(() => row.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await flush();
    expect(setTagRelation).toHaveBeenCalledWith(1, 2, '出生地');
  });
});
