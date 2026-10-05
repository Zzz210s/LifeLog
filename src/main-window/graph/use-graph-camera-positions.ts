/**
 * 相机的位置记忆层(自 `use-graph-camera.ts` 抽出):进视图读一次 settings `graph_positions`
 * (只含被拖过的节点),叠加在布局结果之上;写回是 `commitPositions`(G3 起唯一调用方是拖节点):
 * 先本地生效(松手不闪回),再"读旧值 -> 合并 -> 修剪 -> 写回"串行落库。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../shared/api';
import { GRAPH_POSITIONS_KEY } from './graph-camera-api';
import {
  applyPositions,
  NO_POSITIONS,
  parsePositions,
  prunePositions,
  serializePositions,
  type Positions,
} from './graph-positions';
import type { Point } from './radial';

/** 缺省修剪口径:调用方没给现存标签集时一个条目都不删 */
const NO_IDS: Set<number> = new Set();

export function useGraphCameraPositions(opts: {
  /** 布局结果(位置记忆叠加在它之上) */
  points: Map<number, Point>;
  /** 写回时的"现存标签 id":库里已删的标签不再保留位置;缺省表示不修剪 */
  validIds?: Set<number>;
}): {
  points: Map<number, Point>;
  pinned: ReadonlySet<number>;
  commitPositions: (moved: Positions) => void;
} {
  const [saved, setSaved] = useState<Positions>(NO_POSITIONS);
  const savedRef = useRef<Positions>(NO_POSITIONS);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const validIds = opts.validIds ?? NO_IDS;

  // 位置记忆只读一次;卸载后迟到的回包不碰状态
  useEffect(() => {
    let alive = true;
    void api.getSetting(GRAPH_POSITIONS_KEY).then(
      (raw) => {
        if (!alive) return;
        const parsed = parsePositions(raw);
        savedRef.current = parsed;
        setSaved(parsed);
      },
      () => undefined, // 读不到就用布局坐标,不打扰用户
    );
    return () => {
      alive = false;
    };
  }, []);

  const points = useMemo(() => applyPositions(opts.points, saved), [opts.points, saved]);
  // 被拖过的节点 = 位置记忆里的那些 key(写回只有拖节点一个入口,所以这份集合不会混进别的东西)
  const pinned = useMemo(() => new Set(Object.keys(saved).map(Number)), [saved]);

  const commitPositions = useCallback(
    (moved: Positions): void => {
      // 先本地落地:库的回包还没到,松手也不能闪回原位(React 同批渲染,画面只跳一次)
      const next = { ...savedRef.current, ...moved };
      savedRef.current = next;
      setSaved(next);
      // 写回以库为准(别的会话可能也写过):读旧值 -> 与本地已知位置合并 -> 按现存标签修剪 -> 写回。
      // 修剪只在写的时候做:本地那份可能留着已删标签的条目,但落点表里没有它,画不出来也不会被写回。
      // 串行链:两次拖拽挨得近时,后一次必须读到前一次写进去的值,否则互相覆盖。
      writes.current = writes.current
        .then(async () => {
          const old = parsePositions(await api.getSetting(GRAPH_POSITIONS_KEY));
          const merged = prunePositions({ ...old, ...savedRef.current }, validIds);
          await api.setSetting(GRAPH_POSITIONS_KEY, serializePositions(merged));
        })
        .catch(() => undefined); // 写失败不打扰用户:本次会话的位置已经在画面上生效
    },
    [validIds],
  );

  return { points, pinned, commitPositions };
}
