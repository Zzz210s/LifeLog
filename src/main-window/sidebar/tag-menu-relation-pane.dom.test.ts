// @vitest-environment jsdom
/**
 * 关系面板的加载态与鼠标采纳细节(自 tag-menu-relation.dom.test.ts 抽出,守 200 行上限):
 * 读取未回来时禁用输入与候选、Enter 不写库;查询无命中给空态;候选 mousedown 采纳并 preventDefault。
 */
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { at, flush, mountHost } from './__fixtures__/tag-menu-harness';
import type { RelationRef } from '../../shared/types';
import { TagMenuRelationPane } from './TagMenuRelationPane';

const { listTagRelations, setTagRelation, renameLineName, removeLine } = vi.hoisted(() => ({
  listTagRelations: vi.fn(),
  setTagRelation: vi.fn(),
  renameLineName: vi.fn(),
  removeLine: vi.fn(),
}));
vi.mock('../../shared/api', () => ({
  api: { listTagRelations, setTagRelation, renameLineName, removeLine },
}));


const SELF = at(1, '关系测试甲');
const OTHER = at(3, '关系测试丙');
const ROWS = [SELF, OTHER];
const EDGES: RelationRef[] = [
  { toTagId: 2, path: '关系测试乙', name: '关系测试乙', nameId: null, nameText: '', lineId: 702 },
];

let root: Root;
let host: HTMLDivElement;
let unmountHost: () => void;

beforeEach(() => {
  listTagRelations.mockReset();
  setTagRelation.mockReset();
  renameLineName.mockReset();
  removeLine.mockReset();
  listTagRelations.mockResolvedValue(EDGES);
  setTagRelation.mockResolvedValue(undefined);
  renameLineName.mockResolvedValue(undefined);
  removeLine.mockResolvedValue(undefined);
  ({ host, root, unmount: unmountHost } = mountHost());
});

afterEach(() => {
  unmountHost();
});


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
  host.querySelector('input[data-relation-target-picker]') as HTMLInputElement;
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

/** 新关系的名字输入框(可空 = 只声明有关系,R12) */
const remarkInput = (): HTMLInputElement =>
  host.querySelector('input[data-relation-remark-input]') as HTMLInputElement;

/** 已有关系行上的名字输入框 */
const rowInput = (): HTMLInputElement =>
  host.querySelector('input[data-relation-name]') as HTMLInputElement;

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

  it('「当前关系」标题恰好渲染一次;空关系给空态文案', async () => {
    listTagRelations.mockResolvedValue([]);
    renderPane();
    await flush();
    const headings = [...host.querySelectorAll('p')].filter((el) => el.textContent === '当前关系');
    expect(headings).toHaveLength(1);
    expect(host.textContent).toContain('还没有建立任何关系');
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

  it('relation_rename_goes_through_name_point:有名字的行改名走名字点,不新开线', async () => {
    listTagRelations.mockResolvedValue([
      { toTagId: 2, path: '地点/日本', name: '日本', nameId: 5, nameText: '国籍' },
    ]);
    renderPane();
    await flush();
    expect(rowInput().value).toBe('国籍');
    setInput(rowInput(), '出生地');
    // React 17+ 的 onBlur 实际监听 focusout:派发 'blur' 不会触发 onBlur
    act(() => rowInput().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await flush();
    expect(renameLineName).toHaveBeenCalledWith(5, '出生地');
    expect(setTagRelation).not.toHaveBeenCalled();
  });

  it('nameless_line_shows_placeholder_and_names_via_tag_relation:无名字线显示「(无名字)」,输入名字后走 set_tag_relation 取名', async () => {
    renderPane();
    await flush();
    expect(rowInput().value).toBe('');
    expect(rowInput().placeholder).toBe('(无名字)');
    setInput(rowInput(), '国籍');
    act(() => rowInput().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await flush();
    expect(setTagRelation).toHaveBeenCalledWith(1, 2, '国籍');
    expect(renameLineName).not.toHaveBeenCalled();
  });
});
