/**
 * 标签菜单主面板的关系读数(自 TagMenu.tsx 拆出,守 200 行上限):
 * 菜单一打开就读本标签的全部出边,供主面板「标题下方直接列出关系」(不再靠悬浮)。
 *
 * 失败(IPC 缺失 / 抛错)按空关系处理 —— 列不出关系不该让整个菜单挂掉。用
 * `Promise.resolve().then(...)` 包一层,让「api 上还没这个方法」的同步 TypeError 也走 catch
 * (部分单测的 api 替身只 mock 了子面板用到的几个方法)。
 */
import { useEffect, useState } from 'react';
import { api } from '../../shared/api';
import type { RelationRef } from '../../shared/types';

export function useTagMenuRelations(tagId: number): RelationRef[] | null {
  const [relations, setRelations] = useState<RelationRef[] | null>(null);

  useEffect(() => {
    let alive = true;
    setRelations(null);
    Promise.resolve()
      .then(() => api.listTagRelations(tagId))
      .then((r) => {
        if (alive) setRelations(r);
      })
      .catch(() => {
        if (alive) setRelations([]);
      });
    return () => {
      alive = false;
    };
  }, [tagId]);

  return relations;
}
