// @vitest-environment jsdom
/**
 * T3 行内行为层:**单击真值表**(设计 §4.1 主表 8 格)× 容器行(§4.2 的 9 格)。
 * 行只读「当前模式 + 修饰键 + 该行是否可选」派发 `RowIntent`:条件补丁在 T1 的纯函数、
 * 执行在 T4 的 `use-tag-click`,所以本层的读数只有一件事 —— 这一次点击派发了哪个意图。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLICK_TABLE,
  LEAF,
  dblclickRow,
  mountTagRow,
  modLabel,
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
});

/** 有子级但计数 0 的补位容器(结构节点):不可选,只能展开 */
const HOLDER: TagNode = rowFixtureTree([{ path: 'a/b', depth: 2, self_count: 0, subtree_count: 0 }]);
/** 无子级的空实体:不可选也没有子树 */
const BLANK: TagNode = rowFixtureTree([{ path: '空实体', depth: 1, self_count: 0, subtree_count: 0 }]);
const PARENT: TagNode = rowFixtureTree([
  { id: 1, path: '书籍', depth: 1, self_count: 1, subtree_count: 2 },
  { id: 2, path: '书籍/SQL', depth: 2, self_count: 1, subtree_count: 1 },
]);

describe('可选行(§4.1:2 模式 × 4 修饰键状态 = 8 格)', () => {
  for (const [mode, mods, want] of CLICK_TABLE) {
    it(`${mode} × ${modLabel(mods)} 单击 = ${want}`, () => {
      const onIntent = vi.fn();
      clickRow(h.render({ mode, onIntent }), mods);
      expect(onIntent).toHaveBeenCalledTimes(1);
      expect(onIntent).toHaveBeenCalledWith(want, LEAF);
    });
  }

  it('⌘ 与 Ctrl 归一:metaKey + 单击 = andAdd', () => {
    const onIntent = vi.fn();
    clickRow(h.render({ mode: 'open', onIntent }), { metaKey: true });
    expect(onIntent).toHaveBeenCalledWith('andAdd', LEAF);
  });

  it('修饰键压过模式:open 模式无修饰键 = only(只看这一条,不开卡片),按住 Ctrl 仍是 andAdd', () => {
    const plain = vi.fn();
    clickRow(h.render({ mode: 'open', onIntent: plain }));
    expect(plain).toHaveBeenCalledWith('only', LEAF);

    const withCtrl = vi.fn();
    clickRow(h.render({ mode: 'open', onIntent: withCtrl }), { ctrlKey: true });
    expect(withCtrl.mock.calls[0][0]).toBe('andAdd');
  });

  it('多修饰键同时按下只出一个动作:Ctrl+Alt = andAdd,Ctrl+Alt+Shift 也只有一次', () => {
    const both = vi.fn();
    clickRow(h.render({ onIntent: both }), { ctrlKey: true, altKey: true });
    expect(both.mock.calls[0][0]).toBe('andAdd');

    const all = vi.fn();
    clickRow(h.render({ onIntent: all }), { ctrlKey: true, altKey: true, shiftKey: true });
    expect(all).toHaveBeenCalledTimes(1);
    expect(all.mock.calls[0][0]).toBe('andAdd');
  });
});

describe('容器行(§4.2:2 模式 × 4 修饰键状态 结果全同)', () => {
  for (const [mode, mods, want] of CLICK_TABLE) {
    it(`${mode} × ${modLabel(mods)}:有子级的容器恒 expand(不写条件/不开卡片)`, () => {
      const onIntent = vi.fn();
      clickRow(h.render({ node: HOLDER, mode, onIntent }), mods);
      expect(onIntent).toHaveBeenCalledTimes(1);
      expect(onIntent).toHaveBeenCalledWith('expand', HOLDER);
      expect(onIntent).not.toHaveBeenCalledWith(want, HOLDER);
    });
  }

  it('无子级的空实体:单击同样派发 expand(「还没有内容」的提示由上层给)', () => {
    const onIntent = vi.fn();
    clickRow(h.render({ node: BLANK, onIntent }));
    expect(onIntent).toHaveBeenCalledWith('expand', BLANK);
  });

  it('可展开行也是 expand 的主体:它自己的单击仍按模式走(容器口径只认 subtreeCount)', () => {
    const onIntent = vi.fn();
    clickRow(h.render({ node: PARENT, mode: 'open', onIntent }));
    expect(onIntent).toHaveBeenCalledWith('only', PARENT);
  });
});

describe('双击(2026-10-17:预览卡片退到双击)', () => {
  it('open 档双击可选行 = open(卡片入口只剩这一个)', () => {
    const onIntent = vi.fn();
    dblclickRow(h.render({ mode: 'open', onIntent }));
    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(onIntent).toHaveBeenCalledWith('open', LEAF);
  });

  it('filter 档双击仍是 expand(两档下双击都不写条件)', () => {
    const onIntent = vi.fn();
    dblclickRow(h.render({ node: PARENT, mode: 'filter', onIntent }));
    expect(onIntent).toHaveBeenCalledWith('expand', PARENT);
  });

  it('容器行双击恒 expand:不可选行没有卡片可看', () => {
    const onIntent = vi.fn();
    dblclickRow(h.render({ node: HOLDER, mode: 'open', onIntent }));
    expect(onIntent).toHaveBeenCalledWith('expand', HOLDER);
  });
});
