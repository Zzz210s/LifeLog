/**
 * 关系图的图数据(G2 Task 5 自 `GraphView` 抽出,守行数红线):
 * 进视图拉一次;标签菜单改完标签后 `reload()` 重拉(path 与计数都要跟着变)。
 * 相机与选中留在视图层,重拉不会让它们复位;迟到/卸载后的回包一律不碰状态。
 *
 * Task 5 起顺带把**标签关系边**拉进来(从已有的 `list_tag_facts` 摊平,不新开 IPC):
 * 关系是增强信息,取不到就退空 —— 图照画,不因它把整个视图拉红。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api';
import type { GraphData } from '../../shared/types';
import { relationEdges, type RelationEdge } from './graph-relations';

export interface GraphDataApi {
  data: GraphData | null;
  /** 标签关系边(两端都是标签 id);取不到时为空数组 */
  relations: RelationEdge[];
  /** 拉取失败(首次失败与重拉失败都算):视图据此给中文提示,不装作空图 */
  failed: boolean;
  /** 重拉(标签菜单的写操作之后) */
  reload: () => void;
}

/** 全量事实 -> 关系边;IPC 缺项(测试替身)或失败都退空数组 */
async function safeRelations(): Promise<RelationEdge[]> {
  try {
    return relationEdges((await api.listTagFacts()).facts);
  } catch {
    return [];
  }
}

export function useGraphData(): GraphDataApi {
  const [data, setData] = useState<GraphData | null>(null);
  const [relations, setRelations] = useState<RelationEdge[]>([]);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);

  const load = useCallback((): void => {
    void api.graphData().then(
      (d) => {
        if (alive.current) {
          setData(d);
          setFailed(false);
        }
      },
      () => {
        if (alive.current) setFailed(true); // 重拉失败也要说:图可能已经不是库里那个样子
      },
    );
    void safeRelations().then((r) => {
      if (alive.current) setRelations(r);
    });
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  return { data, relations, failed, reload: load };
}
