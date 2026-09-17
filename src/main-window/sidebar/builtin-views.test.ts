import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, isFilterEmpty } from '../../shared/filter-conditions';
import { BUILTIN_VIEWS } from './builtin-views';

const view = (key: string) => BUILTIN_VIEWS.find((v) => v.key === key)!;

describe('内置视图条件(D7 前端常量与 Rust 侧镜像)', () => {
  it('全部 = 空条件(等价于全部笔记、最新在前)', () => {
    expect(view('all').conditions).toEqual(EMPTY_FILTER);
    expect(isFilterEmpty(view('all').conditions)).toBe(true);
  });

  it('待办 = `待办` 含子级 且排除 `done` 含子级', () => {
    const c = view('todo').conditions;
    expect(c.tags).toEqual([{ path: '待办', includeChildren: true }]);
    expect(c.excludeTags).toEqual([{ path: 'done', includeChildren: true }]);
    expect(c.keyword).toBeNull();
    expect(c.tagPresence).toBeNull();
    expect(c.expr).toBeNull();
    expect(c.sort).toBe('newest');
  });

  it('待办不再是 `todo`/`done` 精确匹配(旧口径已废弃)', () => {
    const c = view('todo').conditions;
    expect(c.tags.some((t) => t.path === 'todo')).toBe(false);
    expect(c.excludeTags.some((t) => t.path === 'done' && !t.includeChildren)).toBe(false);
  });

  it('无自定义标签 = 无任何标签(tagPresence none,不含引入/排除标签)', () => {
    const c = view('untagged').conditions;
    expect(c.tagPresence).toBe('none');
    expect(c.tags).toEqual([]);
    expect(c.excludeTags).toEqual([]);
    expect(isFilterEmpty(c)).toBe(false);
  });

  it('三个内置视图键与标题齐全且唯一', () => {
    expect(BUILTIN_VIEWS.map((v) => [v.key, v.title])).toEqual([
      ['all', '全部'],
      ['todo', '待办'],
      ['untagged', '无自定义标签'],
    ]);
  });
});
