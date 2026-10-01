/**
 * 选中标签(含子孙)的「出链 N / 入链 M」(L4 信息条)。
 *
 * 与图数据**分开**取:这是一条按子树聚合的查询(递归 CTE),为了一个信息条上的数字把 768 个
 * 标签全算一遍不划算;选中标签时才拉,换标签重拉(读数与选中标签必须对得上,不留上一个的残数)。
 * 只读、失败静默退回 null(信息条退化成 `–`,不因为一个读数把整个条子拖红)。
 */
import { useEffect, useState } from 'react';
import { api } from '../../shared/api';
import type { GraphLinkDegrees } from '../../shared/types';

export function useLinkDegrees(tagId: number): GraphLinkDegrees | null {
  const [degrees, setDegrees] = useState<GraphLinkDegrees | null>(null);

  useEffect(() => {
    let alive = true;
    setDegrees(null); // 换标签先归零:上一个标签的数留在这里就是错的口径
    void api.graphLinkDegrees(tagId).then(
      (r) => {
        if (alive) setDegrees(r);
      },
      () => {
        if (alive) setDegrees(null);
      },
    );
    return () => {
      alive = false; // 卸载/换标签后迟到的回包不碰状态
    };
  }, [tagId]);

  return degrees;
}
