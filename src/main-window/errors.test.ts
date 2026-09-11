import { describe, expect, it } from 'vitest';
import { ERROR_KINDS, dropError, putError } from './errors';

describe('putError', () => {
  it('不同来源并存,互不覆盖(跨源覆盖会让先到的错误被永久吞掉)', () => {
    const m = putError(putError({}, 'tags', '标签加载失败'), 'query', '加载笔记失败');
    expect(m).toEqual({ query: '加载笔记失败', tags: '标签加载失败' });
  });

  it('同来源后到覆盖先到(该来源以最新失败为准)', () => {
    expect(putError({ query: '旧' }, 'query', '新')).toEqual({ query: '新' });
  });
});

describe('dropError', () => {
  it('只清同源,不牵连他源', () => {
    expect(dropError({ query: 'a', tags: 'b' }, 'query')).toEqual({ tags: 'b' });
  });

  it('清空后键被删除(避免渲染空错误行)', () => {
    expect('query' in dropError({ query: 'a' }, 'query')).toBe(false);
  });

  it('该源本无错误时原样返回(引用不变,避免无谓重渲染)', () => {
    const m = { tags: 'b' };
    expect(dropError(m, 'query')).toBe(m);
  });
});

describe('ERROR_KINDS', () => {
  it('覆盖全部来源且顺序稳定(多错误纵向堆叠的渲染顺序)', () => {
    expect([...ERROR_KINDS]).toEqual(['query', 'tags', 'action']);
  });
});
