// @vitest-environment jsdom
/**
 * 树行的关系小字 / 悬浮卡片(标签关系统一 spec §7):
 * 行内紧跟标签名 `备注 → 目标`(无备注回退目标名),最多 2 个 + `+N`,受开关控制;计数导轨仍在行尾;
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

const tokens = (el: Element): string[] => el.className.split(/\s+/).filter(Boolean);

/** 名字块:行内唯一文本为标签名「日本」的 span */
const nameSpan = (row: HTMLElement): HTMLElement =>
  [...row.querySelectorAll('span')].find((s) => s.textContent === '日本') as HTMLElement;

/** jsdom 里 scrollWidth/clientWidth 恒 0:手动造出「被 CSS 截断」的读数再触发 React 的 onMouseEnter */
function markTruncated(el: HTMLElement): void {
  Object.defineProperty(el, 'scrollWidth', { value: 999, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: 100, configurable: true });
}

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

  it('属性名来自边:目标标签名字自带 md 备注时,小字仍是边上的属性名', () => {
    render({ relations: [rel(10, '[日本](日出之国)', '国籍')], showRelations: true });
    expect(relationTexts()).toEqual(['国籍 → 日本']);
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

  it('行内顺序为 名字 → 关系小字 → 计数(优先级 2026-10-06 调整)', () => {
    const row = render({ relations: [rel(10, '国籍', '国别')], showRelations: true });
    const html = row.innerHTML;
    expect(html.indexOf('日本')).toBeLessThan(html.indexOf('data-tag-relation'));
    expect(html.indexOf('data-tag-relation')).toBeLessThan(html.indexOf('data-count-rail'));
    // 关系小字必须落在名字与计数之间(顺序反过来即红)
    expect(html.slice(html.indexOf('日本'), html.indexOf('data-count-rail'))).toContain('data-tag-relation');
  });
});

describe('名字优先不截断(2026-10-06 B 方案)', () => {
  it('名字块 shrink-0(不参与收缩),关系小字可收缩 + 封顶 + truncate(截断先落在小字)', () => {
    const row = render({ relations: [rel(10, '国籍', '国别')], showRelations: true });
    const name = tokens(nameSpan(row));
    expect(name).toContain('shrink-0');
    expect(name).not.toContain('shrink');
    expect(name).toContain('truncate');

    const chip = row.querySelector('[data-tag-relation]') as HTMLElement;
    const ct = tokens(chip);
    expect(ct).toContain('shrink');
    expect(ct).not.toContain('shrink-0');
    expect(ct).toContain('min-w-0');
    expect(String(chip.className)).toMatch(/max-w-\[8rem\]/);
    expect(ct).toContain('truncate');
  });

  it('关系小字超长:省略号口径,未截断不挂 title、真被截断时悬停给完整文案', () => {
    const row = render({ relations: [rel(10, '属性', '一段很长很长的箭头备注文字')], showRelations: true });
    const chip = row.querySelector('[data-tag-relation]') as HTMLElement;
    const full = '一段很长很长的箭头备注文字 → 属性';
    expect(chip.textContent).toBe(full);
    expect(chip.getAttribute('title')).toBeNull();
    markTruncated(chip);
    chip.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(chip.getAttribute('title')).toBe(full);
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
