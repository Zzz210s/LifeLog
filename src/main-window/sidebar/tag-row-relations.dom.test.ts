// @vitest-environment jsdom
/**
 * 树行的关系小字 / 悬浮卡片(标签关系统一 spec §7):
 * 行内末尾 `备注 → 目标`(无备注回退目标名),最多 2 个 + `+N`,受开关控制;
 * 悬浮卡片走行上的 `data-tip`(瞬时 HoverTip),列出全部关系(不受行内 2 条上限约束)。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RelationRef } from '../../shared/types';
import { TagRow } from './TagRow';
import type { TagNode } from './tag-tree';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rel = (toTagId: number, name: string, remark = ''): RelationRef => ({
  toTagId,
  path: name,
  name,
  remark,
});

/** 叶子标签(直接给 TagNode:buildTree 会把缺的祖先补成结构节点,拿不到这一行) */
const node: TagNode = {
  id: 1,
  path: '地点轴/国籍/日本',
  name: '日本',
  depth: 3,
  sortOrder: 0,
  selfCount: 4,
  subtreeCount: 9,
  children: [],
};

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(over: { relations?: readonly RelationRef[]; showRelations?: boolean } = {}): HTMLElement {
  act(() => {
    root.render(
      createElement(TagRow, {
        node,
        flat: false,
        selected: false,
        excluded: false,
        expanded: false,
        onToggle: () => {},
        onToggleExpand: () => {},
        onContextMenu: () => {},
        dragSource: false,
        dropZone: null,
        dragActive: false,
        onDragStart: () => {},
        onDragEnd: () => {},
        onDragOver: () => {},
        onDrop: () => {},
        onDragLeave: () => {},
        relations: over.relations ?? [],
        showRelations: over.showRelations ?? false,
      })
    );
  });
  return host.querySelector('button[data-tag-path]') as HTMLElement;
}

const relationTexts = (): string[] =>
  [...host.querySelectorAll('[data-tag-relation]')].map((el) => el.textContent ?? '');

describe('树行关系小字(开关)', () => {
  const RELS = [rel(10, '国籍', '国别'), rel(11, '所在')];

  it('开关关闭:树行不出现关系', () => {
    render({ relations: RELS, showRelations: false });
    expect(relationTexts()).toEqual([]);
    expect(host.textContent).not.toContain('国别 → 国籍');
  });

  it('开关打开:显示 `备注 → 目标`,无备注回退目标名', () => {
    render({ relations: RELS, showRelations: true });
    expect(relationTexts()).toEqual(['国别 → 国籍', '所在']);
  });

  it('0/1/2 条原样显示,不出现 +N', () => {
    expect(relationTexts()).toEqual([]);
    render({ relations: [rel(10, '国籍', '国别')], showRelations: true });
    expect(relationTexts()).toEqual(['国别 → 国籍']);
  });

  it('超过 2 条:显示 2 条 + `+N`', () => {
    render({
      relations: [rel(10, '国籍', '国别'), rel(11, '所在'), rel(12, '要求'), rel(13, '产地')],
      showRelations: true,
    });
    expect(relationTexts()).toEqual(['国别 → 国籍', '所在', '+2']);
  });

  it('关系小字在名字与计数之后(优先级 名字 → 计数 → 关系)', () => {
    const row = render({ relations: [rel(10, '国籍', '国别')], showRelations: true });
    const html = row.innerHTML;
    expect(html.indexOf('日本')).toBeLessThan(html.indexOf('data-count-rail'));
    expect(html.indexOf('data-count-rail')).toBeLessThan(html.indexOf('data-tag-relation'));
  });
});

describe('悬浮卡片(行 data-tip):列出全部关系', () => {
  it('有关系:第二行列出全部(不受行内 2 条上限约束)', () => {
    const row = render({
      relations: [rel(10, '国籍', '国别'), rel(11, '所在'), rel(12, '产地')],
    });
    expect(row.getAttribute('data-tip')).toBe(
      '地点轴/国籍/日本(本级 4 / 含子级 9)\n关系：国别 → 国籍、所在、产地'
    );
  });

  it('无关系:只有路径与计数行', () => {
    const row = render();
    expect(row.getAttribute('data-tip')).toBe('地点轴/国籍/日本(本级 4 / 含子级 9)');
    expect(row.getAttribute('data-tip')).not.toContain('关系');
  });

  it('行上不再挂原生 title(卡片走 data-tip)', () => {
    const row = render({ relations: [rel(10, '国籍', '国别')] });
    expect(row.getAttribute('title')).toBeNull();
  });
});
