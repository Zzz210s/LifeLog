import { describe, expect, it } from 'vitest';
import {
  SOURCE_TAG_DEBOUNCE_MS,
  createRequestGate,
  displayedTagCount,
  type SourceTagPreview,
} from './source-tags';

describe('displayedTagCount(实时标签数的显示口径)', () => {
  it('解析结果对应当前源码时用解析值', () => {
    const preview: SourceTagPreview = { source: '#a #b', count: 2 };
    expect(displayedTagCount(preview, '#a #b', 5)).toBe(2);
  });

  it('尚未返回(null)时回退已保存标签数,不闪烁成 0', () => {
    expect(displayedTagCount(null, '#a #b', 5)).toBe(5);
    expect(displayedTagCount(null, '#a', 0)).toBe(0);
  });

  it('源码已变(解析结果过期)时同样回退已保存标签数', () => {
    const stale: SourceTagPreview = { source: '#a', count: 1 };
    expect(displayedTagCount(stale, '#a #b', 5)).toBe(5);
  });

  it('解析出 0 个标签是有效读数,不得被误当失败回退', () => {
    const preview: SourceTagPreview = { source: '正文 #x', count: 0 };
    expect(displayedTagCount(preview, '正文 #x', 3)).toBe(0);
  });

  it('防抖窗口为 250ms', () => {
    expect(SOURCE_TAG_DEBOUNCE_MS).toBe(250);
  });
});

describe('createRequestGate(序号守卫)', () => {
  it('只有最新一次请求的号仍有效', () => {
    const gate = createRequestGate();
    const first = gate.next();
    const second = gate.next();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  it('invalidate 让在途请求整体作废(换源/卸载)', () => {
    const gate = createRequestGate();
    const id = gate.next();
    expect(gate.isCurrent(id)).toBe(true);
    gate.invalidate();
    expect(gate.isCurrent(id)).toBe(false);
  });

  it('连续取号后旧号永久失效(连打场景)', () => {
    const gate = createRequestGate();
    const ids = [gate.next(), gate.next(), gate.next()];
    expect(ids.filter((id) => gate.isCurrent(id))).toEqual([ids[2]]);
  });
});
