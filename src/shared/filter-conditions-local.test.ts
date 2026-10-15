/**
 * 就地变更后的本地重判(`filter-conditions-local`):只有"单组、全 AND、仅本级引入标签"才敢不重查后端。
 * 关系语法(2026-10-12 起 `Note.tags` 是标签线 `NoteTag[]`)后,**命中判据仍只有路径** ——
 * 名字不参与命中(设计 §5.2 的消费方清单),否则给某个目标起了名字就会让笔记从筛选里掉出去。
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, type FilterConditions } from './filter-conditions';
import { canEvaluateLocally, matchesTagsByPath } from './filter-conditions-local';
import { noteTag } from './__fixtures__/note-tag';

/** 条件对象:仅本级(不含子级)的引入标签,正是本地重判的唯一合法形态 */
const cond = (...paths: string[]): FilterConditions => ({
  ...EMPTY_FILTER,
  tags: paths.map((path) => ({ path, includeChildren: false })),
});

describe('matchesTagsByPath', () => {
  it('按路径命中:线有没有名字都一样', () => {
    const path = '工作/项目A';
    expect(matchesTagsByPath({ tags: [noteTag(path)] }, cond(path))).toBe(true);
    expect(matchesTagsByPath({ tags: [noteTag(path, '重点')] }, cond(path))).toBe(true);
  });

  it('关系名不参与命中:名字与条件路径相同也不算命中', () => {
    const input = { tags: [noteTag('工作/项目A', '生活')] };
    expect(matchesTagsByPath(input, cond('生活'))).toBe(false);
    expect(matchesTagsByPath(input, cond('工作/项目A'))).toBe(true);
  });

  it('多个条件全要满足(AND);只命中一部分就是 false', () => {
    const input = { tags: [noteTag('工作/项目A', '重点'), noteTag('生活/健身')] };
    expect(matchesTagsByPath(input, cond('工作/项目A', '生活/健身'))).toBe(true);
    expect(matchesTagsByPath(input, cond('工作/项目A', '生活/读书'))).toBe(false);
  });

  it('名字组不是路径:条件写成 `路径(名字)` 不命中', () => {
    expect(matchesTagsByPath({ tags: [noteTag('目标', '国籍')] }, cond('目标(国籍)'))).toBe(false);
  });

  it('canEvaluateLocally 只放行单组全 AND 的仅本级标签(与本次改造无关,顺带钉住)', () => {
    expect(canEvaluateLocally(cond('工作'))).toBe(true);
    expect(canEvaluateLocally({ ...cond('工作'), keyword: 'x' })).toBe(false);
    expect(
      canEvaluateLocally({ ...EMPTY_FILTER, tags: [{ path: '工作', includeChildren: true }] })
    ).toBe(false);
  });
});
