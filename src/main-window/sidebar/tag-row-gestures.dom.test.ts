// @vitest-environment jsdom
/**
 * T3 行内行为层:**非单击手势与键盘**(设计 §4.3 第 13-16 行、§5.7)+ 行的预览视觉(§5.1 / §5.8)。
 * 手势优先级一句话:浮层 > 拖动 > 双击 / 箭头 > 修饰键 > 模式 > 状态退出;本文件钉住的四件事:
 * 拖动起手不算单击、双击不引入延迟、箭头自己 `stopPropagation`、Enter/Space 与单击同义。
 * 2026-10-17 双击口径:`open` 档 + 可选行 = 预览卡片(`open` 意图),其余一律 `expand` ——
 * 原「双击恒 expand」只在 `filter` 档与不可选行上成立(判定在纯函数 `dblIntent`)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEAF,
  dblclickRow,
  keyRow,
  mountTagRow,
  rel,
  clickRow,
  rowFixtureTree,
  type RowHarness,
} from './__fixtures__/tag-row-harness';
import type { TagNode } from './tag-tree';

let h: RowHarness;

beforeEach(() => {
  h = mountTagRow();
});

afterEach(() => {
  h.unmount();
  vi.useRealTimers();
});

const PARENT: TagNode = rowFixtureTree([
  { id: 1, path: '书籍', depth: 1, self_count: 1, subtree_count: 2 },
  { id: 2, path: '书籍/SQL', depth: 2, self_count: 1, subtree_count: 1 },
]);
/** 有子级但计数 0 的补位容器(结构节点):不可选,双击也只能展开 */
const HOLDER: TagNode = rowFixtureTree([{ path: 'a/b', depth: 2, self_count: 0, subtree_count: 0 }]);

describe('拖动与双击的优先级(§4.3 第 14/16 行)', () => {
  it('拖动起手:拖动中单击不派发任何意图(P15 双保险的第一道)', () => {
    const onIntent = vi.fn();
    clickRow(h.render({ dragActive: true, onIntent }), { ctrlKey: true });
    expect(onIntent).not.toHaveBeenCalled();

    // 同一行不拖时照常派发,证明上面读的是 dragActive 而不是别的
    clickRow(h.render({ dragActive: false, onIntent }), { ctrlKey: true });
    expect(onIntent).toHaveBeenCalledWith('andAdd', LEAF);
  });

  it('拖动中双击也不派发(同一条闸门)', () => {
    const onIntent = vi.fn();
    dblclickRow(h.render({ node: PARENT, dragActive: true, onIntent }));
    expect(onIntent).not.toHaveBeenCalled();
  });

  it('双击派发一次、不留定时器(P9:不引入"等第二次点击")', () => {
    vi.useFakeTimers();
    const onIntent = vi.fn();
    dblclickRow(h.render({ node: PARENT, mode: 'filter', onIntent }));
    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(onIntent).toHaveBeenCalledWith('expand', PARENT);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('双击在 open 档 = 预览卡片(可选行),filter 档与不可选行仍是 expand', () => {
    const open = vi.fn();
    dblclickRow(h.render({ mode: 'open', onIntent: open }));
    expect(open).toHaveBeenCalledWith('open', LEAF);

    const filtered = vi.fn();
    dblclickRow(h.render({ mode: 'filter', onIntent: filtered }));
    expect(filtered).toHaveBeenCalledWith('expand', LEAF);

    const holder = vi.fn();
    dblclickRow(h.render({ node: HOLDER, mode: 'open', onIntent: holder }));
    expect(holder).toHaveBeenCalledWith('expand', HOLDER);
  });

  it('箭头单击:stopPropagation 之后只展开,不派发行动作(§4.3 第 13 行)', () => {
    const onIntent = vi.fn();
    const onToggleExpand = vi.fn();
    const row = h.render({ node: PARENT, mode: 'filter', onIntent, onToggleExpand });
    const arrow = row.querySelector('svg');
    expect(arrow).not.toBeNull();
    if (arrow === null) return;
    clickRow(arrow);
    expect(onToggleExpand).toHaveBeenCalledWith('书籍');
    expect(onIntent).not.toHaveBeenCalled();
  });

  it('行内关系小字点击跟随整行意图(小字是读数,不是独立入口,§4.3 第 15 行)', () => {
    const onIntent = vi.fn();
    const row = h.render({ relations: [rel(10, '中国大陆', '国籍')], showRelations: true, mode: 'open', onIntent });
    const chip = row.querySelector('[data-tag-relation]');
    expect(chip?.textContent).toBe('国籍 中国大陆');
    if (chip === null) return;
    clickRow(chip);
    expect(onIntent).toHaveBeenCalledWith('only', LEAF);
  });
});

describe('键盘等价(§5.7:全部显式处理并吃掉原生 click)', () => {
  it('Enter / Space 与单击同义,Ctrl/Alt/Shift 修饰键同样成立', () => {
    const CASES: Array<[string, KeyboardEventInit, string]> = [
      ['Enter', {}, 'toggle'],
      ['Space', {}, 'toggle'],
      ['Ctrl+Enter', { ctrlKey: true }, 'andAdd'],
      ['Alt+Enter', { altKey: true }, 'exclude'],
      ['Shift+Enter', { shiftKey: true }, 'only'],
    ];
    for (const [label, mods, want] of CASES) {
      const onIntent = vi.fn();
      const row = h.render({ mode: 'filter', onIntent });
      const e = keyRow(row, label === 'Space' ? ' ' : 'Enter', mods);
      expect([label, onIntent.mock.calls[0]?.[0]]).toEqual([label, want]);
      expect(e.defaultPrevented).toBe(true);
    }
  });

  it('Enter 在容器行与模式无关:仍是 expand', () => {
    const onIntent = vi.fn();
    const blank = rowFixtureTree([{ path: '空实体', depth: 1, self_count: 0, subtree_count: 0 }]);
    keyRow(h.render({ node: blank, mode: 'open', onIntent }), 'Enter');
    expect(onIntent).toHaveBeenCalledWith('expand', blank);
  });

  it('ArrowRight 未展开 = 展开;ArrowLeft 只有在已展开时才收起;扁平模式与无子级不拦', () => {
    const onToggleExpand = vi.fn();
    const onIntent = vi.fn();
    const closed = h.render({ node: PARENT, onIntent, onToggleExpand });
    expect(keyRow(closed, 'ArrowRight').defaultPrevented).toBe(true);
    expect(onToggleExpand).toHaveBeenCalledWith('书籍');

    onToggleExpand.mockClear();
    expect(keyRow(closed, 'ArrowLeft').defaultPrevented).toBe(false); // 未展开:不该收起
    expect(onToggleExpand).not.toHaveBeenCalled();

    const flat = h.render({ node: PARENT, flat: true, onIntent, onToggleExpand });
    keyRow(flat, 'ArrowRight');
    expect(onToggleExpand).not.toHaveBeenCalled();

    const leaf = h.render({ onIntent, onToggleExpand });
    keyRow(leaf, 'ArrowRight');
    expect(onToggleExpand).not.toHaveBeenCalled();
    expect(onIntent).not.toHaveBeenCalled(); // 方向键不派发行动作
  });
});

describe('预览的行内视觉(§5.1 / §5.8:一条竖条,三种属性)', () => {
  it('previewing=true:左缘竖条 + data-preview + aria-expanded/aria-controls', () => {
    const row = h.render({ previewing: true, mode: 'open' });
    const bar = row.querySelector('[data-row-bar]');
    expect(bar).not.toBeNull();
    expect(bar?.className).toContain('bg-accent');
    expect(bar?.className).toContain('pointer-events-none');
    expect(row.getAttribute('data-preview')).toBe('true');
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(row.getAttribute('aria-controls')).toBe('tag-preview-card');
    expect(row.getAttribute('aria-pressed')).toBe('false'); // 仍只表示"筛选包含侧"
  });

  it('普通行:无竖条,属性都不挂(脚本按存在与否读数)', () => {
    const row = h.render({});
    expect(row.querySelector('[data-row-bar]')).toBeNull();
    expect(row.getAttribute('data-preview')).toBeNull();
    expect(row.getAttribute('aria-current')).toBeNull();
    expect(row.getAttribute('aria-controls')).toBeNull();
  });
});
