/**
 * 关系图的图数据(G2 Task 5 自 `GraphView` 抽出,守行数红线):
 * 进视图拉一次;标签菜单改完标签后 `reload()` 重拉(path 与计数都要跟着变)。
 * 相机与选中留在视图层,重拉不会让它们复位;迟到/卸载后的回包一律不碰状态。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api';
import type { GraphData } from '../../shared/types';

export interface GraphDataApi {
  data: GraphData | null;
  /** 拉取失败(首次失败与重拉失败都算):视图据此给中文提示,不装作空图 */
  failed: boolean;
  /** 重拉(标签菜单的写操作之后) */
  reload: () => void;
}

export function useGraphData(): GraphDataApi {
  const [data, setData] = useState<GraphData | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void api.graphData().then(
      (d) => {
        if (alive.current) setData(d);
      },
      () => {
        if (alive.current) setFailed(true);
      },
    );
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback((): void => {
    void api.graphData().then(
      (d) => {
        if (!alive.current) return;
        setData(d);
        setFailed(false);
      },
      () => {
        if (alive.current) setFailed(true); // 重拉失败也要说:图可能已经不是库里那个样子
      },
    );
  }, []);

  return { data, failed, reload };
}
