import { useEffect, useMemo, useState } from 'react';
import { api } from '../../shared/api';
import type { Note } from '../../shared/types';

/**
 * 当前这一页笔记的**被引用计数**(卡片「被引用 N」的数据源,L3)。
 * 一次 `IN (...)` 批量取全(设计 §3.0:50 张卡不能 50 次查询),前端把 Map 分给各卡。
 * id 集合未变不重查(按结构指纹,不是对象引用);拉取失败退化为全 0(不显示徽标),不打断信息流。
 */
export function useBacklinkCounts(notes: readonly Note[]): Record<number, number> {
  const [counts, setCounts] = useState<Record<number, number>>({});
  const key = useMemo(() => notes.map((n) => n.id).join(','), [notes]);
  useEffect(() => {
    const ids = key === '' ? [] : key.split(',').map(Number);
    if (ids.length === 0) {
      setCounts({});
      return;
    }
    let alive = true;
    void api.noteLinkCounts(ids).then(
      (map) => {
        if (alive) setCounts(map);
      },
      () => {
        if (alive) setCounts({});
      }
    );
    return () => {
      alive = false;
    };
  }, [key]);
  return counts;
}
