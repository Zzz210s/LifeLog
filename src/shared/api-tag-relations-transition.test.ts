/**
 * 过渡期兼容层的行为钉子(T4 用关系徽章替换后本文件连同两个方法一起删除):
 * setTagTypeFlag 必须**明确 reject 中文原因**(不许静默 resolve 吞掉用户点击),
 * setTagTypes 虽非原子,但要按目标集合正确地增删关系边。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import type { RelationRef } from './types';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('setTagTypeFlag(022 起不可用)', () => {
  it('明确 reject 中文原因,而不是静默 resolve', async () => {
    expect.assertions(1);
    await api.setTagTypeFlag(7, true).then(
      () => {
        throw new Error('不该 resolve:静默实现会吞掉用户点击');
      },
      (e: unknown) => {
        expect(String(e)).toContain('022');
      },
    );
  });
});

describe('setTagTypes 过渡兼容层(增量关系写)', () => {
  it('按目标集合增删:缺的加、多的删、已存在的留着', async () => {
    const rel = (toTagId: number): RelationRef => ({
      toTagId,
      path: `路径${toTagId}`,
      name: `名${toTagId}`,
      remark: '',
    });
    vi.spyOn(api, 'listTagRelations').mockResolvedValue([rel(1), rel(2)]);
    const set = vi.spyOn(api, 'setTagRelation').mockResolvedValue();
    const remove = vi.spyOn(api, 'removeTagRelation').mockResolvedValue();

    await api.setTagTypes(9, [2, 3]);

    expect(remove.mock.calls).toEqual([[9, 1]]);
    expect(set.mock.calls).toEqual([[9, 3]]);
  });
});
